/**
 * ECE — Valoración Inicial de Enfermería (maestro one-per-episodio).
 *
 * Documento NTEC: VAL_INI_ENF — Valoración Inicial de Enfermería al Ingreso.
 * Norma: TDR §4 / MINSAL Acuerdo n.° 1616 (2024).
 * Cardinalidad: exactamente 1 valoración por episodio_hospitalario (1:1).
 *   La restricción se aplica a nivel de aplicación; el router rechaza creación
 *   si ya existe una valoración para el mismo episodio_hospitalario_id.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (código tipo: VAL_INI_ENF)
 * ---------------------------------------------------------------------------
 *   borrador  → firmado   (NURSE firma — sin PIN; solo la sesión activa)
 *   firmado   → validado  (NURSE superiora / coordinadora de enfermería)
 *
 *   No existe estado anulado: la valoración es inmutable post-firma per NTEC.
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro del callback de withWorkflowContext)
 * ---------------------------------------------------------------------------
 *   'ece.valoracion_inicial.firmada'  — payload: { valoracionId, episodioId,
 *                                         enfermeroId, organizationId }
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.valoracion_inicial_enfermeria  — fila principal; columnas clave:
 *     id, episodio_hospitalario_id, escala_braden, escala_morse, escala_dolor,
 *     estado_consciencia, dispositivos_invasivos, plan_cuidados_inicial,
 *     estado (borrador|firmado|validado), firmado_por uuid, firmado_en timestamptz
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC (todas las procedures: requireRole(["NURSE"]))
 * ---------------------------------------------------------------------------
 *   list, get, create, update → NURSE
 *   firmar, validar           → NURSE
 *
 * Raw SQL es obligatorio porque el schema ece usa un schema Postgres separado
 * (opción B) y no está mapeado en schema.prisma. Se usa prisma.$queryRaw
 * con Prisma.sql para prevención de SQL injection.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { emitDomainEvent } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../workflow/context";
import type { TenantContext } from "@his/contracts";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Schemas Zod locales
// (espejo de packages/contracts/src/schemas/ece-valoracion-inicial.ts)
// ---------------------------------------------------------------------------

const estadoValoracion = z.enum(["borrador", "firmado", "validado", "anulado"]);

const eceValoracionInicialCreateSchema = z.object({
  episodioHospitalarioId: z.string().uuid(),
  fechaHora: z.coerce.date(),
  antecedentesPersonales: z.string().trim().max(4000).optional(),
  antecedentesFamiliares: z.string().trim().max(4000).optional(),
  alergiasConocidas: z.string().trim().max(2000).optional(),
  medicamentosActuales: z.string().trim().max(2000).optional(),
  escalaBraden: z.number().int().min(6).max(23).optional(),
  escalaMorse: z.number().int().min(0).max(125).optional(),
  escalaDolor: z.number().int().min(0).max(10).optional(),
  estadoConsciencia: z.string().trim().max(500).optional(),
  dispositivosInvasivos: z.string().trim().max(1000).optional(),
  educacionBrindada: z.string().trim().max(2000).optional(),
  planCuidadosInicial: z.string().trim().max(4000).optional(),
});

const eceValoracionInicialUpdateSchema = eceValoracionInicialCreateSchema
  .partial()
  .extend({ id: z.string().uuid() });

const eceValoracionInicialListSchema = z.object({
  episodioHospitalarioId: z.string().uuid().optional(),
  estado: estadoValoracion.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const eceValoracionInicialIdSchema = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Tipos raw SQL
// ---------------------------------------------------------------------------

export interface ValoracionInicialRow {
  id: string;
  episodio_hospitalario_id: string;
  instancia_id: string | null;
  fecha_hora: Date;
  antecedentes_personales: string | null;
  antecedentes_familiares: string | null;
  alergias_conocidas: string | null;
  medicamentos_actuales: string | null;
  escala_braden: number | null;
  escala_morse: number | null;
  escala_dolor: number | null;
  estado_consciencia: string | null;
  dispositivos_invasivos: string | null;
  educacion_brindada: string | null;
  plan_cuidados_inicial: string | null;
  registrado_por: string;
  estado_registro: string;
  firmado_por: string | null;
  firmado_en: Date | null;
  validado_por: string | null;
  validado_en: Date | null;
  registrado_en: Date;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function buildEceCtx(tenant: TenantContext, userId: string) {
  return {
    personalId: userId,
    establecimientoId: tenant.establishmentId ?? tenant.organizationId,
  };
}

async function withEceContext<T>(
  prisma: PrismaClient,
  tenant: TenantContext,
  userId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return withWorkflowContext(prisma, buildEceCtx(tenant, userId), fn);
}

async function findValoracion(
  prisma: Pick<PrismaClient, "$queryRaw">,
  id: string,
): Promise<ValoracionInicialRow | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<ValoracionInicialRow[]>)`
    SELECT id, episodio_hospitalario_id, instancia_id, fecha_hora,
           antecedentes_personales, antecedentes_familiares,
           alergias_conocidas, medicamentos_actuales,
           escala_braden, escala_morse, escala_dolor,
           estado_consciencia, dispositivos_invasivos,
           educacion_brindada, plan_cuidados_inicial,
           registrado_por, estado_registro,
           firmado_por, firmado_en, validado_por, validado_en,
           registrado_en
      FROM ece.valoracion_inicial_enfermeria
     WHERE id = ${id}::uuid
     LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonalId(
  prisma: Pick<PrismaClient, "$queryRaw">,
  userId: string,
): Promise<string | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Array<{ id: string }>>)`
    SELECT id FROM ece.personal_salud
     WHERE his_user_id = ${userId}::uuid
       AND activo = true
     LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function countValoracionesActivas(
  prisma: Pick<PrismaClient, "$queryRaw">,
  episodioHospitalarioId: string,
): Promise<number> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Array<{ cnt: bigint }>>)`
    SELECT COUNT(*) AS cnt
      FROM ece.valoracion_inicial_enfermeria
     WHERE episodio_hospitalario_id = ${episodioHospitalarioId}::uuid
       AND estado_registro <> 'anulado'
  `;
  return Number(rows[0]?.cnt ?? 0);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const nurseRole = requireRole(["NURSE"]);

export const eceValoracionInicialRouter = router({
  /** Lista valoraciones iniciales con filtros opcionales. */
  list: nurseRole
    .input(eceValoracionInicialListSchema)
    .query(async ({ ctx, input }) => {
      // HD-19 — envuelto en withEceContext para que el rol Supabase se
      // demote a `authenticated` y las RLS de `ece.*` apliquen. Sin esto,
      // el rol original con BYPASSRLS regresaba filas de otra organización.
      return withEceContext(ctx.prisma, ctx.tenant, ctx.user.id, async (tx) => {
        return (tx.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<ValoracionInicialRow[]>)`
          SELECT id, episodio_hospitalario_id, instancia_id, fecha_hora,
                 antecedentes_personales, antecedentes_familiares,
                 alergias_conocidas, medicamentos_actuales,
                 escala_braden, escala_morse, escala_dolor,
                 estado_consciencia, dispositivos_invasivos,
                 educacion_brindada, plan_cuidados_inicial,
                 registrado_por, estado_registro,
                 firmado_por, firmado_en, validado_por, validado_en,
                 registrado_en
            FROM ece.valoracion_inicial_enfermeria
           WHERE (${input.episodioHospitalarioId ?? null}::uuid IS NULL
                  OR episodio_hospitalario_id = ${input.episodioHospitalarioId ?? null}::uuid)
             AND (${input.estado ?? null}::text IS NULL
                  OR estado_registro = ${input.estado ?? null})
           ORDER BY registrado_en DESC
           LIMIT ${input.limit}
        `;
      });
    }),

  /** Obtiene una valoración por id. */
  get: nurseRole
    .input(eceValoracionInicialIdSchema)
    .query(async ({ ctx, input }) => {
      // HD-19 — mismo motivo que list. findValoracion hace $queryRaw, debe
      // ejecutarse con el rol demoted dentro de la transacción.
      const row = await withEceContext(ctx.prisma, ctx.tenant, ctx.user.id, async (tx) => {
        return findValoracion(tx, input.id);
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /**
   * Crea la valoración inicial (estado: borrador).
   * Valida que el episodio no tenga ya una valoración activa.
   */
  create: nurseRole
    .input(eceValoracionInicialCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const activas = await countValoracionesActivas(
        ctx.prisma,
        input.episodioHospitalarioId,
      );
      if (activas > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "El episodio ya tiene una valoración inicial activa. Anúlela antes de crear una nueva.",
        });
      }

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        const personalId = await findPersonalId(tx, userId);
        if (!personalId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No se encontró un profesional ECE asociado a su cuenta.",
          });
        }

        const rows = await (tx.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string }>>)`
          INSERT INTO ece.valoracion_inicial_enfermeria
            (episodio_hospitalario_id, fecha_hora,
             antecedentes_personales, antecedentes_familiares,
             alergias_conocidas, medicamentos_actuales,
             escala_braden, escala_morse, escala_dolor,
             estado_consciencia, dispositivos_invasivos,
             educacion_brindada, plan_cuidados_inicial,
             registrado_por, estado_registro, registrado_en)
          VALUES
            (${input.episodioHospitalarioId}::uuid,
             ${input.fechaHora}::timestamptz,
             ${input.antecedentesPersonales ?? null},
             ${input.antecedentesFamiliares ?? null},
             ${input.alergiasConocidas ?? null},
             ${input.medicamentosActuales ?? null},
             ${input.escalaBraden ?? null},
             ${input.escalaMorse ?? null},
             ${input.escalaDolor ?? null},
             ${input.estadoConsciencia ?? null},
             ${input.dispositivosInvasivos ?? null},
             ${input.educacionBrindada ?? null},
             ${input.planCuidadosInicial ?? null},
             ${personalId}::uuid,
             'borrador',
             now())
          RETURNING id
        `;
        const created = rows[0];
        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No se pudo crear la valoración inicial.",
          });
        }
        return { id: created.id };
      });
    }),

  /**
   * Actualiza una valoración en estado borrador.
   * No permite modificar episodioHospitalarioId.
   */
  update: nurseRole
    .input(eceValoracionInicialUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const userId = ctx.user.id;

      const row = await findValoracion(ctx.prisma, id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.estado_registro !== "borrador") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Solo se puede actualizar una valoración en estado 'borrador'. Estado actual: '${row.estado_registro}'.`,
        });
      }

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.valoracion_inicial_enfermeria SET
            fecha_hora                = COALESCE(${fields.fechaHora ?? null}::timestamptz, fecha_hora),
            antecedentes_personales   = COALESCE(${fields.antecedentesPersonales ?? null}, antecedentes_personales),
            antecedentes_familiares   = COALESCE(${fields.antecedentesFamiliares ?? null}, antecedentes_familiares),
            alergias_conocidas        = COALESCE(${fields.alergiasConocidas ?? null}, alergias_conocidas),
            medicamentos_actuales     = COALESCE(${fields.medicamentosActuales ?? null}, medicamentos_actuales),
            escala_braden             = COALESCE(${fields.escalaBraden ?? null}, escala_braden),
            escala_morse              = COALESCE(${fields.escalaMorse ?? null}, escala_morse),
            escala_dolor              = COALESCE(${fields.escalaDolor ?? null}, escala_dolor),
            estado_consciencia        = COALESCE(${fields.estadoConsciencia ?? null}, estado_consciencia),
            dispositivos_invasivos    = COALESCE(${fields.dispositivosInvasivos ?? null}, dispositivos_invasivos),
            educacion_brindada        = COALESCE(${fields.educacionBrindada ?? null}, educacion_brindada),
            plan_cuidados_inicial     = COALESCE(${fields.planCuidadosInicial ?? null}, plan_cuidados_inicial)
          WHERE id = ${id}::uuid
        `;
        return { ok: true as const };
      });
    }),

  /**
   * Firma la valoración (ENF).
   * Transición: borrador → firmado.
   * Emite outbox `ece.valoracion_inicial.firmada`.
   */
  firmar: nurseRole
    .input(eceValoracionInicialIdSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const orgId = ctx.tenant.organizationId;

      const row = await findValoracion(ctx.prisma, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.estado_registro !== "borrador") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Solo se puede firmar una valoración en estado 'borrador'. Estado actual: '${row.estado_registro}'.`,
        });
      }

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        // firmado_por FK → ece.personal_salud(id); resolver desde his_user_id
        const personalId = await findPersonalId(tx, userId);
        if (!personalId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No se encontró un profesional ECE asociado a su cuenta.",
          });
        }

        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.valoracion_inicial_enfermeria
             SET estado_registro = 'firmado',
                 firmado_por     = ${personalId}::uuid,
                 firmado_en      = now()
           WHERE id = ${input.id}::uuid
        `;

        await emitDomainEvent(tx as unknown as PrismaClient, {
          organizationId: orgId,
          eventType: "ece.valoracion_inicial.firmada",
          aggregateType: "ValoracionInicialEnfermeria",
          aggregateId: input.id,
          emittedById: userId,
          payload: {
            valoracionId: input.id,
            episodioHospitalarioId: row.episodio_hospitalario_id,
            enfermeraId: userId,
          },
        });

        return { ok: true as const };
      });
    }),

  /**
   * Valida la valoración (ENF supervisora / jefe de enfermería).
   * Transición: firmado → validado.
   */
  validar: nurseRole
    .input(eceValoracionInicialIdSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const row = await findValoracion(ctx.prisma, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.estado_registro !== "firmado") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Solo se puede validar una valoración en estado 'firmado'. Estado actual: '${row.estado_registro}'.`,
        });
      }

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        // validado_por FK → ece.personal_salud(id); resolver desde his_user_id
        const personalId = await findPersonalId(tx, userId);
        if (!personalId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No se encontró un profesional ECE asociado a su cuenta.",
          });
        }

        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.valoracion_inicial_enfermeria
             SET estado_registro = 'validado',
                 validado_por    = ${personalId}::uuid,
                 validado_en     = now()
           WHERE id = ${input.id}::uuid
        `;
        return { ok: true as const };
      });
    }),
});
