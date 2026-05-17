/**
 * ECE — Sala de Expulsión (Doc 14 NTEC).
 *
 * Registra el período expulsivo, nacimiento y alumbramiento.
 * `registrarNacimiento` es atómico: marca inicio_expulsivo_ts + nacimiento_ts
 * y crea un placeholder de atención RN (atencion_rn_placeholder).
 * `firmar` requiere rol MC (médico ginecólogo).
 *
 * Outbox: `registrarNacimiento` emite `ece.nacimiento.registrado`.
 *
 * Spec: TDR §14 NTEC / Acuerdo n.° 1616 (MINSAL 2024).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { emitDomainEvent } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../workflow/context";
import type { TenantContext } from "@his/contracts";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const tipoParto = z.enum(["eutocico", "distocico", "cesarea_emergencia"]);
const presentacionFetal = z.enum(["cefalica", "pelvica", "transversa", "otra"]);
const mecanismoParto = z.enum(["espontaneo", "forceps", "vacuoextractor", "espatulas"]);

const listInput = z.object({
  episodioHospitalarioId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const getInput = z.object({ id: z.string().uuid() });

const registrarNacimientoInput = z.object({
  episodioHospitalarioId: z.string().uuid(),
  tipoParto,
  inicioExpulsivoTs: z.coerce.date().optional(),
  nacimientoTs: z.coerce.date(),
  presentacionFetal,
  mecanismoParto,
  episiotomia: z.boolean().default(false),
  desgarroPeriNealGrado: z.number().int().min(0).max(4).optional(),
  alumbramiento_ts: z.coerce.date().optional(),
  placentaCompleta: z.boolean().optional(),
  sangradoEstimadoMl: z.number().int().min(0).optional(),
});

const firmarInput = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Tipos raw SQL
// ---------------------------------------------------------------------------

interface SalaExpulsionRow {
  id: string;
  episodio_hospitalario_id: string;
  tipo_parto: string;
  inicio_expulsivo_ts: Date | null;
  nacimiento_ts: Date;
  presentacion_fetal: string;
  mecanismo_parto: string;
  episiotomia: boolean;
  desgarro_perineal_grado: number | null;
  alumbramiento_ts: Date | null;
  placenta_completa: boolean | null;
  sangrado_estimado_ml: number | null;
  atencion_rn_placeholder: string | null;
  registrado_por: string;
  estado_registro: string;
  firmado_por: string | null;
  firmado_en: Date | null;
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

async function findSalaExpulsion(
  prisma: Pick<PrismaClient, "$queryRaw">,
  id: string,
): Promise<SalaExpulsionRow | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<SalaExpulsionRow[]>)`
    SELECT id, episodio_hospitalario_id, tipo_parto,
           inicio_expulsivo_ts, nacimiento_ts,
           presentacion_fetal, mecanismo_parto,
           episiotomia, desgarro_perineal_grado,
           alumbramiento_ts, placenta_completa, sangrado_estimado_ml,
           atencion_rn_placeholder,
           registrado_por, estado_registro, firmado_por, firmado_en,
           registrado_en
      FROM ece.sala_expulsion
     WHERE id = ${id}::uuid
     LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const physicianRole = requireRole(["PHYSICIAN", "MC", "NURSE"]);
const mcRole = requireRole(["PHYSICIAN", "MC"]);

export const eceSalaExpulsionRouter = router({
  /** Lista registros de sala de expulsión con filtro opcional por episodio. */
  list: physicianRole
    .input(listInput)
    .query(async ({ ctx, input }) => {
      return (ctx.prisma.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<SalaExpulsionRow[]>)`
        SELECT id, episodio_hospitalario_id, tipo_parto,
               inicio_expulsivo_ts, nacimiento_ts,
               presentacion_fetal, mecanismo_parto,
               episiotomia, desgarro_perineal_grado,
               alumbramiento_ts, placenta_completa, sangrado_estimado_ml,
               atencion_rn_placeholder,
               registrado_por, estado_registro, firmado_por, firmado_en,
               registrado_en
          FROM ece.sala_expulsion
         WHERE (${input.episodioHospitalarioId ?? null}::uuid IS NULL
                OR episodio_hospitalario_id = ${input.episodioHospitalarioId ?? null}::uuid)
         ORDER BY nacimiento_ts DESC
         LIMIT ${input.limit}
      `;
    }),

  /** Obtiene un registro por id. */
  get: physicianRole
    .input(getInput)
    .query(async ({ ctx, input }) => {
      const row = await findSalaExpulsion(ctx.prisma, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /**
   * Registra el nacimiento de forma atómica.
   * - Crea el registro en `ece.sala_expulsion` (estado borrador).
   * - Genera un UUID como placeholder de atención RN.
   * - Emite `ece.nacimiento.registrado` al outbox.
   *
   * El placeholder RN permite que el módulo newborn lo tome y complete
   * la atención del recién nacido de forma asíncrona.
   */
  registrarNacimiento: mcRole
    .input(registrarNacimientoInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const orgId = ctx.tenant.organizationId;

      // Verificar que el episodio no tenga ya un registro activo
      const existing = await (ctx.prisma.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<Array<{ cnt: bigint }>>)`
        SELECT COUNT(*) AS cnt
          FROM ece.sala_expulsion
         WHERE episodio_hospitalario_id = ${input.episodioHospitalarioId}::uuid
      `;
      if (Number(existing[0]?.cnt ?? 0) > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "El episodio ya tiene un registro de sala de expulsión.",
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

        // Genera UUID para placeholder de atención RN
        const rnPlaceholderRows = await (tx.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ rn_id: string }>>)`
          SELECT gen_random_uuid() AS rn_id
        `;
        const rnPlaceholderId = rnPlaceholderRows[0]?.rn_id ?? null;

        const rows = await (tx.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string }>>)`
          INSERT INTO ece.sala_expulsion
            (episodio_hospitalario_id, tipo_parto,
             inicio_expulsivo_ts, nacimiento_ts,
             presentacion_fetal, mecanismo_parto,
             episiotomia, desgarro_perineal_grado,
             alumbramiento_ts, placenta_completa, sangrado_estimado_ml,
             atencion_rn_placeholder,
             registrado_por, estado_registro, registrado_en)
          VALUES
            (${input.episodioHospitalarioId}::uuid,
             ${input.tipoParto}::ece.tipo_parto,
             ${input.inicioExpulsivoTs ?? null}::timestamptz,
             ${input.nacimientoTs}::timestamptz,
             ${input.presentacionFetal},
             ${input.mecanismoParto},
             ${input.episiotomia},
             ${input.desgarroPeriNealGrado ?? null},
             ${input.alumbramiento_ts ?? null}::timestamptz,
             ${input.placentaCompleta ?? null},
             ${input.sangradoEstimadoMl ?? null},
             ${rnPlaceholderId}::uuid,
             ${personalId}::uuid,
             'borrador',
             now())
          RETURNING id
        `;

        const created = rows[0];
        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No se pudo registrar el nacimiento.",
          });
        }

        await emitDomainEvent(tx as unknown as PrismaClient, {
          organizationId: orgId,
          eventType: "ece.nacimiento.registrado",
          aggregateType: "SalaExpulsion",
          aggregateId: created.id,
          emittedById: userId,
          payload: {
            salaExpulsionId: created.id,
            episodioHospitalarioId: input.episodioHospitalarioId,
            nacimientoTs: input.nacimientoTs.toISOString(),
            tipoParto: input.tipoParto,
            rnPlaceholderId,
            medicoId: userId,
          },
        });

        return { id: created.id, rnPlaceholderId };
      });
    }),

  /**
   * Firma el registro (ginecólogo MC).
   * Transición: borrador → firmado.
   */
  firmar: mcRole
    .input(firmarInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const row = await findSalaExpulsion(ctx.prisma, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.estado_registro !== "borrador") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Solo se puede firmar en estado 'borrador'. Estado actual: '${row.estado_registro}'.`,
        });
      }

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.sala_expulsion
             SET estado_registro = 'firmado',
                 firmado_por     = ${userId}::uuid,
                 firmado_en      = now()
           WHERE id = ${input.id}::uuid
        `;
        return { ok: true as const };
      });
    }),
});
