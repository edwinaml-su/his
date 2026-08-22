/**
 * Sprint UI Finance — Centros de Costo (TDR §23).
 *
 * El modelo Prisma `CostCenter` tiene los campos base:
 *   id, organizationId, code, name, parentId, active, createdAt, updatedAt.
 *
 * Los campos extendidos que el usuario agregó al schema PG (tipo, permite_imputacion,
 * responsable_id, base_distribucion, centro_responsable_minsal,
 * cuenta_ingreso_default_id, cuenta_gasto_default_id) aún no están en schema.prisma.
 * Los leemos/escribimos vía $queryRaw / $executeRaw hasta que se sincronice el schema.
 *
 * `CostCenterAllocationRule` tampoco existe en Prisma — los procedures de prorrateo
 * son stubs que devuelven [] hasta que @DBA sincronice el schema.
 *
 * Reglas invariantes (spec §6):
 *   - code formato T-AAA-SSS; inmutable post-creación.
 *   - centros tipo "apoyo" deben tener base_distribucion.
 *   - NO DELETE — solo setActive(false).
 *
 * Autorización: ADMIN o FIN_CON para mutaciones; cualquier usuario autenticado
 * puede listar (selección en transacciones por módulos clínicos).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@his/database";
import { router, protectedProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";
import type { TenantContext } from "@his/contracts";

// ---------------------------------------------------------------------------
// Schemas locales
// ---------------------------------------------------------------------------

/** Formato T-AAA-SSS: T ∈ {1,2,3}, AAA y SSS son 3 letras/dígitos mayúsculas. */
const CODE_REGEX = /^[123]-[A-Z0-9]{3}-[A-Z0-9]{3}$/;

const tipoEnum = z.enum(["productivo", "intermedio", "apoyo"]);
type Tipo = z.infer<typeof tipoEnum>;

const baseDistribucionEnum = z.enum([
  "m2",
  "empleados",
  "horas",
  "pacientes_atendidos",
  "kilos_lavados",
  "consumo_electrico",
  "porcentaje_fijo",
]);

const listInput = z
  .object({
    tipo: tipoEnum.optional(),
    activo: z.boolean().optional(),
  })
  .optional();

const getInput = z.object({ id: z.string().uuid() });

const createInput = z.object({
  code: z
    .string()
    .toUpperCase()
    .regex(CODE_REGEX, "Formato inválido. Debe ser T-AAA-SSS (ej. 1-CEX-GEN)."),
  name: z.string().trim().min(3).max(120),
  tipo: tipoEnum,
  parentId: z.string().uuid().optional(),
  permiteImputacion: z.boolean().default(true),
  responsableId: z.string().uuid().optional(),
  baseDistribucion: baseDistribucionEnum.optional(),
  centroResponsableMinsal: z.string().max(40).optional(),
  cuentaIngresoDefaultId: z.string().uuid().optional(),
  cuentaGastoDefaultId: z.string().uuid().optional(),
});

const updateInput = z.object({
  id: z.string().uuid(),
  // code es inmutable — no se incluye en update.
  name: z.string().trim().min(3).max(120).optional(),
  parentId: z.string().uuid().nullable().optional(),
  permiteImputacion: z.boolean().optional(),
  responsableId: z.string().uuid().nullable().optional(),
  baseDistribucion: baseDistribucionEnum.nullable().optional(),
  centroResponsableMinsal: z.string().max(40).nullable().optional(),
  cuentaIngresoDefaultId: z.string().uuid().nullable().optional(),
  cuentaGastoDefaultId: z.string().uuid().nullable().optional(),
});

const setActiveInput = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

const listAllocationRulesInput = z.object({
  costCenterId: z.string().uuid(),
});

const createAllocationRuleInput = z.object({
  costCenterId: z.string().uuid(),
  name: z.string().trim().min(3).max(120),
  periodicidad: z.enum(["mensual", "trimestral", "anual"]),
  targets: z
    .array(
      z.object({
        destinoCostCenterId: z.string().uuid(),
        porcentaje: z.number().min(0.01).max(100),
      }),
    )
    .min(1),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveOrgId(tenantOrgId: string | undefined): string {
  if (!tenantOrgId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Sin tenant activo. Selecciona una organización.",
    });
  }
  return tenantOrgId;
}

/**
 * R02: este router usa `protectedProcedure` (no `tenantProcedure`), así que
 * `ctx.tenant` es opcional en el tipo. `withTenantContext` necesita
 * `{userId, organizationId, breakGlass}` — se arma aquí una vez resuelto el
 * orgId (via `resolveOrgId`) para no repetir el cast en cada procedure.
 */
function buildTenantForRls(
  userId: string,
  organizationId: string,
  breakGlass: boolean | undefined,
): Pick<TenantContext, "userId" | "organizationId" | "breakGlass"> {
  return { userId, organizationId, breakGlass: breakGlass ?? false };
}

async function assertWriteRole(
  prisma: { userOrganizationRole: { findFirst: Function } },
  userId: string,
  organizationId: string,
): Promise<void> {
  const now = new Date();
  const membership = await prisma.userOrganizationRole.findFirst({
    where: {
      userId,
      organizationId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
      role: { code: { in: ["ADMIN", "FIN_CON"] } },
    },
  });
  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Requiere rol ADMIN o FIN_CON vigente.",
    });
  }
}

function validateApoyoRule(tipo: Tipo, baseDistribucion: string | undefined | null): void {
  if (tipo === "apoyo" && !baseDistribucion) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Los centros de tipo apoyo requieren base de distribución para prorrateo.",
    });
  }
}

function rethrowPrisma(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "El código de centro de costo ya existe en esta organización.",
      });
    }
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const costCenterRouter = router({
  /**
   * Lista centros de costo de la org del tenant.
   * Filtros opcionales: tipo, activo.
   * Los campos extendidos se obtienen via raw query (schema drift).
   *
   * R02 — decisión (a): `CostCenter` tiene 2 policies (`cost_center_tenant`,
   * `cost_center_tenant_isolation`) para ALL commands, `organizationId =
   * current_org_id()`, y `authenticated` tiene grants completos (verificado
   * en prod 2026-08-22). Defensa en profundidad sobre el filtro JS existente.
   */
  list: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
    const orgId = resolveOrgId(ctx.tenant?.organizationId);
    const tenant = buildTenantForRls(ctx.user!.id, orgId, ctx.tenant?.breakGlass);

    // Intentamos leer campos extendidos via raw. Si la columna no existe (entorno
    // dev sin migración aplicada), caemos al resultado del ORM sin esos campos.
    try {
      const whereClause: string[] = [`"organizationId" = '${orgId}'`];
      if (input?.tipo) {
        whereClause.push(`tipo = '${input.tipo}'`);
      }
      if (input?.activo !== undefined) {
        whereClause.push(`active = ${input.activo}`);
      }
      const where = whereClause.join(" AND ");

      const rows = await withTenantContext(ctx.prisma, tenant, (tx) =>
        tx.$queryRawUnsafe<
          Array<{
            id: string;
            organizationId: string;
            code: string;
            name: string;
            parentId: string | null;
            active: boolean;
            tipo: string | null;
            permite_imputacion: boolean | null;
            responsable_id: string | null;
            base_distribucion: string | null;
            centro_responsable_minsal: string | null;
            createdAt: Date;
            updatedAt: Date;
          }>
        >(
          `SELECT id, "organizationId", code, name, "parentId", active,
                  CASE WHEN column_exists.has_tipo THEN tipo ELSE NULL END as tipo,
                  CASE WHEN column_exists.has_tipo THEN permite_imputacion ELSE NULL END as permite_imputacion,
                  CASE WHEN column_exists.has_tipo THEN responsable_id ELSE NULL END as responsable_id,
                  CASE WHEN column_exists.has_tipo THEN base_distribucion ELSE NULL END as base_distribucion,
                  CASE WHEN column_exists.has_tipo THEN centro_responsable_minsal ELSE NULL END as centro_responsable_minsal,
                  "createdAt", "updatedAt"
           FROM "CostCenter",
                (SELECT EXISTS(
                  SELECT 1 FROM information_schema.columns
                  WHERE table_name='CostCenter' AND column_name='tipo'
                ) as has_tipo) as column_exists
           WHERE ${where}
           ORDER BY code ASC`,
        ),
      );
      return rows;
    } catch {
      // Fallback: ORM sin campos extendidos
      const rows = await withTenantContext(ctx.prisma, tenant, (tx) =>
        tx.costCenter.findMany({
          where: {
            organizationId: orgId,
            ...(input?.activo !== undefined ? { active: input.activo } : {}),
          },
          orderBy: { code: "asc" },
        }),
      );
      return rows.map((r) => ({ ...r, tipo: null, permite_imputacion: null, responsable_id: null, base_distribucion: null, centro_responsable_minsal: null }));
    }
  }),

  /**
   * Detalle de un centro con todos los campos extendidos.
   *
   * R02: a diferencia de `update`/`setActive` (que sí validan rol contra la
   * org REAL del registro vía `assertWriteRole`), este `get` no tenía NINGÚN
   * chequeo de tenant — cualquier usuario autenticado, sin siquiera tener rol
   * en esa org, podía leer el detalle completo de un centro de costo de OTRA
   * organización adivinando su UUID. Se cierra igual que `list` (requiere
   * tenant activo + `withTenantContext`): `cost_center_tenant`/
   * `cost_center_tenant_isolation` cubren SELECT.
   */
  get: protectedProcedure.input(getInput).query(async ({ ctx, input }) => {
    const orgId = resolveOrgId(ctx.tenant?.organizationId);
    const tenant = buildTenantForRls(ctx.user!.id, orgId, ctx.tenant?.breakGlass);

    const center = await withTenantContext(ctx.prisma, tenant, (tx) =>
      tx.costCenter.findFirst({ where: { id: input.id, organizationId: orgId } }),
    );
    if (!center) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Centro de costo no encontrado." });
    }

    // Intentamos traer campos extendidos
    try {
      const rows = await withTenantContext(ctx.prisma, tenant, (tx) =>
        tx.$queryRawUnsafe<
          Array<{
            tipo: string | null;
            permite_imputacion: boolean | null;
            responsable_id: string | null;
            base_distribucion: string | null;
            centro_responsable_minsal: string | null;
            cuenta_ingreso_default_id: string | null;
            cuenta_gasto_default_id: string | null;
          }>
        >(
          `SELECT
             CASE WHEN column_exists.has_tipo THEN tipo ELSE NULL END as tipo,
             CASE WHEN column_exists.has_tipo THEN permite_imputacion ELSE NULL END as permite_imputacion,
             CASE WHEN column_exists.has_tipo THEN responsable_id ELSE NULL END as responsable_id,
             CASE WHEN column_exists.has_tipo THEN base_distribucion ELSE NULL END as base_distribucion,
             CASE WHEN column_exists.has_tipo THEN centro_responsable_minsal ELSE NULL END as centro_responsable_minsal,
             CASE WHEN column_exists.has_tipo THEN cuenta_ingreso_default_id ELSE NULL END as cuenta_ingreso_default_id,
             CASE WHEN column_exists.has_tipo THEN cuenta_gasto_default_id ELSE NULL END as cuenta_gasto_default_id
           FROM "CostCenter",
                (SELECT EXISTS(
                  SELECT 1 FROM information_schema.columns
                  WHERE table_name='CostCenter' AND column_name='tipo'
                ) as has_tipo) as column_exists
           WHERE id = '${input.id}'`,
        ),
      );
      const ext = rows[0] ?? {};
      return { ...center, ...ext };
    } catch {
      return {
        ...center,
        tipo: null,
        permite_imputacion: null,
        responsable_id: null,
        base_distribucion: null,
        centro_responsable_minsal: null,
        cuenta_ingreso_default_id: null,
        cuenta_gasto_default_id: null,
      };
    }
  }),

  /**
   * Crea un nuevo centro. Valida:
   * - code formato T-AAA-SSS (Zod + server)
   * - apoyo requiere base_distribucion
   * - code inmutable (se guarda en el create; no existe update de code)
   */
  /**
   * R02 — decisión (a): `orgId` viene de `resolveOrgId(ctx.tenant)` (el mismo
   * boundary que `assertWriteRole` ya usa), así que envolver en
   * `withTenantContext` es defensa en profundidad pura — no cambia a qué org
   * se puede escribir, solo agrega el enforcement RLS real detrás del filtro JS.
   */
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const orgId = resolveOrgId(ctx.tenant?.organizationId);
    await assertWriteRole(ctx.prisma as Parameters<typeof assertWriteRole>[0], ctx.user!.id, orgId);
    validateApoyoRule(input.tipo, input.baseDistribucion);
    const tenant = buildTenantForRls(ctx.user!.id, orgId, ctx.tenant?.breakGlass);

    // Verificar unicidad de code antes de intentar INSERT (mejor error message)
    const existing = await ctx.prisma.costCenter.findFirst({
      where: { organizationId: orgId, code: input.code },
      select: { id: true },
    });
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `El código ${input.code} ya existe en esta organización.`,
      });
    }

    try {
      return await withTenantContext(ctx.prisma, tenant, async (tx) => {
        const created = await tx.costCenter.create({
          data: {
            organizationId: orgId,
            code: input.code,
            name: input.name,
            parentId: input.parentId ?? null,
            active: true,
          },
        });

        // Intentar escribir campos extendidos si la columna existe
        try {
          await tx.$executeRawUnsafe(
            `UPDATE "CostCenter"
             SET tipo = $1,
                 permite_imputacion = $2,
                 responsable_id = $3,
                 base_distribucion = $4,
                 centro_responsable_minsal = $5,
                 cuenta_ingreso_default_id = $6,
                 cuenta_gasto_default_id = $7
             WHERE id = $8
               AND EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='CostCenter' AND column_name='tipo'
               )`,
            input.tipo,
            input.permiteImputacion,
            input.responsableId ?? null,
            input.baseDistribucion ?? null,
            input.centroResponsableMinsal ?? null,
            input.cuentaIngresoDefaultId ?? null,
            input.cuentaGastoDefaultId ?? null,
            created.id,
          );
        } catch {
          // columnas no migradas aún; ignorar
        }

        return created;
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  /**
   * Edita un centro. El campo `code` no está disponible en este mutation
   * (spec §6: inmutable post-creación).
   *
   * R02 — decisión (c), NO envuelto en `withTenantContext`: a diferencia de
   * `list`/`create`/`get`, este procedure resuelve la org desde el registro
   * (`center.organizationId`) y valida el rol del caller CONTRA ESA org via
   * `assertWriteRole` — no contra `ctx.tenant` (el tenant activo). Es el mismo
   * diseño multi-org que `audit.router.ts listOrgChanges` (usuario con rol en
   * varias orgs, no limitado al tenant seleccionado en la cookie). Ligar
   * `withTenantContext` a `ctx.tenant.organizationId` aquí exigiría que
   * `ctx.tenant` esté seteado (hoy no es requisito) y, si difiere de
   * `center.organizationId`, el UPDATE afectaría 0 filas bajo RLS —
   * rompiendo silenciosamente la edición cross-org que `assertWriteRole` ya
   * autoriza explícitamente. La defensa real de este procedure es el rol
   * ADMIN/FIN_CON validado contra la org del registro, no un tenant GUC.
   */
  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const center = await ctx.prisma.costCenter.findUnique({
      where: { id: input.id },
      select: { id: true, organizationId: true },
    });
    if (!center) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Centro de costo no encontrado." });
    }
    await assertWriteRole(ctx.prisma as Parameters<typeof assertWriteRole>[0], ctx.user!.id, center.organizationId);

    // Validar regla apoyo si se cambia base_distribucion
    if (input.baseDistribucion !== undefined) {
      // Necesitamos saber el tipo actual para validar
      try {
        const rows = await ctx.prisma.$queryRawUnsafe<Array<{ tipo: string | null }>>(
          `SELECT CASE WHEN EXISTS(
             SELECT 1 FROM information_schema.columns
             WHERE table_name='CostCenter' AND column_name='tipo'
           ) THEN tipo ELSE NULL END as tipo
           FROM "CostCenter" WHERE id = '${input.id}'`,
        );
        const tipoActual = rows[0]?.tipo as Tipo | null;
        if (tipoActual === "apoyo" && !input.baseDistribucion) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Los centros de tipo apoyo requieren base de distribución.",
          });
        }
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        // columna no existe; ignorar validación
      }
    }

    // Actualizar campos base via ORM
    const updated = await ctx.prisma.costCenter.update({
      where: { id: input.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      },
    });

    // Actualizar campos extendidos vía raw
    try {
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE "CostCenter"
         SET permite_imputacion = COALESCE($1, permite_imputacion),
             responsable_id = $2,
             base_distribucion = $3,
             centro_responsable_minsal = $4,
             cuenta_ingreso_default_id = $5,
             cuenta_gasto_default_id = $6
         WHERE id = $7
           AND EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name='CostCenter' AND column_name='tipo'
           )`,
        input.permiteImputacion ?? null,
        input.responsableId ?? null,
        input.baseDistribucion ?? null,
        input.centroResponsableMinsal ?? null,
        input.cuentaIngresoDefaultId ?? null,
        input.cuentaGastoDefaultId ?? null,
        input.id,
      );
    } catch {
      // columnas no migradas
    }

    return updated;
  }),

  /**
   * Toggle flag active. NO elimina el registro (spec §6).
   * Si active=false, solicita confirmación en UI (Modal Dialog).
   *
   * R02 — decisión (c): mismo diseño cross-org de `update` (rol validado
   * contra `center.organizationId`, no contra `ctx.tenant`). Ver comentario
   * de `update` para el detalle.
   */
  setActive: protectedProcedure.input(setActiveInput).mutation(async ({ ctx, input }) => {
    const center = await ctx.prisma.costCenter.findUnique({
      where: { id: input.id },
      select: { id: true, organizationId: true, active: true },
    });
    if (!center) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Centro de costo no encontrado." });
    }
    await assertWriteRole(ctx.prisma as Parameters<typeof assertWriteRole>[0], ctx.user!.id, center.organizationId);

    if (center.active === input.active) {
      return center; // idempotente
    }

    return ctx.prisma.costCenter.update({
      where: { id: input.id },
      data: { active: input.active },
    });
  }),

  /**
   * Lista reglas de prorrateo para un centro de apoyo.
   * STUB: la tabla CostCenterAllocationRule aún no está en schema.prisma.
   * TODO(@DBA): agregar CostCenterAllocationRule al schema y quitar stub.
   *
   * R02 — decisión (a): a diferencia de `update`/`setActive`/
   * `createAllocationRule`, este procedure NO tenía NINGÚN chequeo de rol ni
   * de tenant (ni `assertWriteRole` ni filtro JS) — cualquier usuario
   * autenticado podía listar las reglas de prorrateo de un centro de costo de
   * OTRA org adivinando su UUID. Se cierra igual que `get`: requiere tenant
   * activo + `withTenantContext` (`cost_center_tenant*` cubre el `findFirst`;
   * `CostCenterAllocationRule` tiene `alloc_rule_tenant` — aunque aquí se
   * consulta por `costCenterId`, no por `organizationId`, así que la policy
   * de `CostCenterAllocationRule` sola no bastaba — el `center` findFirst
   * scoped al tenant es lo que cierra el hueco).
   */
  listAllocationRules: protectedProcedure
    .input(listAllocationRulesInput)
    .query(async ({ ctx, input }) => {
      const orgId = resolveOrgId(ctx.tenant?.organizationId);
      const tenant = buildTenantForRls(ctx.user!.id, orgId, ctx.tenant?.breakGlass);

      return withTenantContext(ctx.prisma, tenant, async (tx) => {
        const center = await tx.costCenter.findFirst({
          where: { id: input.costCenterId, organizationId: orgId },
          select: { id: true },
        });
        if (!center) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Centro de costo no encontrado." });
        }

        try {
          const rows = await tx.$queryRawUnsafe<
            Array<{ id: string; name: string; periodicidad: string; createdAt: Date }>
          >(
            `SELECT id, name, periodicidad, "createdAt"
             FROM "CostCenterAllocationRule"
             WHERE "costCenterId" = '${input.costCenterId}'
             ORDER BY "createdAt" DESC`,
          );
          return rows;
        } catch {
          // Tabla no existe aún
          return [];
        }
      });
    }),

  /**
   * Crea una regla de prorrateo.
   * STUB: valida que porcentajes sumen 100% y persiste si la tabla existe.
   * TODO(@DBA): crear tabla CostCenterAllocationRule + CostCenterAllocationTarget.
   *
   * R02 — decisión (c): mismo diseño cross-org de `update`/`setActive` (rol
   * validado contra `center.organizationId`, no contra `ctx.tenant`). Además
   * el mutation SIEMPRE termina en `NOT_IMPLEMENTED` (no hay escritura real
   * hoy), así que no hay superficie de escritura RLS que defender todavía.
   */
  createAllocationRule: protectedProcedure
    .input(createAllocationRuleInput)
    .mutation(async ({ ctx, input }) => {
      const center = await ctx.prisma.costCenter.findUnique({
        where: { id: input.costCenterId },
        select: { id: true, organizationId: true },
      });
      if (!center) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Centro de costo no encontrado." });
      }
      await assertWriteRole(ctx.prisma as Parameters<typeof assertWriteRole>[0], ctx.user!.id, center.organizationId);

      const totalPct = input.targets.reduce((s, t) => s + t.porcentaje, 0);
      if (Math.abs(totalPct - 100) > 0.001) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `La suma de porcentajes debe ser exactamente 100% (actual: ${totalPct.toFixed(2)}%).`,
        });
      }

      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "La tabla de reglas de prorrateo está pendiente de migración. Disponible en Wave 3+.",
      });
    }),
});
