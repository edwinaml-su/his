/**
 * Router tRPC — Establecimientos (CRUD admin).
 *
 * Hasta 2026-09-10 los establecimientos (HE/CM/US, ver SQL 227) se sembraban
 * por SQL directo contra prod. Edwin pidió que sean parametrizables desde el
 * admin — este router cubre alta/edición/activación, tenant-scoped.
 *
 * `Establishment` SÍ tiene modelo Prisma (a diferencia de ServicePriceList*):
 * se usa `withTenantContext` (contrato RLS, packages/trpc/src/rls-context.ts)
 * en cada procedure.
 *
 * NOTA: el INSERT dispara el trigger bridge `ece.fn_establishment_bridge_after_insert`
 * (crea el espejo en `ece.establecimiento`) — no se duplica aquí.
 *
 * RBAC: ADMIN o DIR para mutaciones y listado (router de administración).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@his/database";
import { router, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

const adminProc = requireRole(["ADMIN", "DIR"]);

// ---------------------------------------------------------------------------
// Schemas locales
// ---------------------------------------------------------------------------

const listInput = z.object({ activeOnly: z.boolean().optional() }).optional();

const createInput = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  addressLine: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
});

const updateInput = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  addressLine: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
});

const setActiveInput = z.object({ id: z.string().uuid(), active: z.boolean() });

function rethrowUniqueCode(err: unknown, code: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `El código ${code} ya existe en esta organización.`,
    });
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const establishmentRouter = router({
  /**
   * Lista los establecimientos de la org del tenant (activos e inactivos).
   *
   * Enriquece cada fila con el GLN asociado (`ece.gs1_gln` nivel
   * "establecimiento", ver SQL 229) para mostrarlo de solo lectura — la
   * asociación se gestiona desde el árbol GLN (`/admin/gs1/gln`), no aquí.
   *
   * La consulta de GLN corre sobre `ctx.prisma` directo (fuera de
   * `withTenantContext`/`withEceContext`), igual que `gs1-catalogos.router.ts`
   * `byId`/`deactivate` — es una lectura admin-only (ya gateada por
   * `adminProc`) de un catálogo por-establecimiento cuya RLS (SQL 200) solo
   * permite ver UN establecimiento a la vez vía GUC; este listado necesita
   * los GLN de TODOS los establecimientos de la org en una sola pasada, algo
   * que la política RLS de `ece.gs1_gln` no soporta en una sola transacción.
   */
  list: adminProc.input(listInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    const establishments = await withTenantContext(prisma, tenant, (tx) =>
      tx.establishment.findMany({
        where: {
          organizationId: tenant.organizationId,
          ...(input?.activeOnly ? { active: true } : {}),
        },
        orderBy: { code: "asc" },
      }),
    );
    if (establishments.length === 0) return establishments;

    type GlnRow = { establishment_id: string; codigo: string; descripcion: string };
    const glnRows = await prisma.$queryRawUnsafe<GlnRow[]>(
      `SELECT pe.id AS establishment_id, g.codigo, g.descripcion
         FROM "Establishment" pe
         JOIN ece.establecimiento ee ON ee.establishment_id = pe.id
         JOIN ece.gs1_gln g ON g.establecimiento_id = ee.id AND g.tipo = 'establecimiento'
        WHERE pe."organizationId" = $1`,
      tenant.organizationId,
    );
    const glnByEstablishment = new Map(glnRows.map((r) => [r.establishment_id, r]));

    return establishments.map((e) => {
      const gln = glnByEstablishment.get(e.id);
      return { ...e, glnCodigo: gln?.codigo ?? null, glnDescripcion: gln?.descripcion ?? null };
    });
  }),

  /** Crea un establecimiento nuevo en la org del tenant. */
  create: adminProc.input(createInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    try {
      return await withTenantContext(prisma, tenant, (tx) =>
        tx.establishment.create({
          data: {
            organizationId: tenant.organizationId,
            code: input.code,
            name: input.name,
            addressLine: input.addressLine ?? null,
            phone: input.phone ?? null,
            createdBy: user.id,
            updatedBy: user.id,
          },
        }),
      );
    } catch (err) {
      rethrowUniqueCode(err, input.code);
    }
  }),

  /** Edita un establecimiento existente del tenant. */
  update: adminProc.input(updateInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    try {
      return await withTenantContext(prisma, tenant, async (tx) => {
        const existing = await tx.establishment.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Establecimiento no encontrado." });
        }

        return tx.establishment.update({
          where: { id: input.id },
          data: {
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            updatedBy: user.id,
          },
        });
      });
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      rethrowUniqueCode(err, input.code ?? "");
    }
  }),

  /** Activa/desactiva un establecimiento (no hay DELETE — solo toggle). */
  setActive: adminProc.input(setActiveInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const existing = await tx.establishment.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        select: { id: true, active: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Establecimiento no encontrado." });
      }
      if (existing.active === input.active) {
        return existing; // idempotente
      }
      return tx.establishment.update({
        where: { id: input.id },
        data: { active: input.active, updatedBy: user.id },
      });
    });
  }),
});
