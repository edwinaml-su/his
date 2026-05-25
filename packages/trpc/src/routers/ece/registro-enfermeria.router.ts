/**
 * ECE — Registro de Enfermería + Administración de Medicamento (MAR/Kardex).
 *
 * Documento NTEC: Doc 7 — Registro de Enfermería y Administración de Medicamento
 *   (MAR = Medication Administration Record / Kardex de Enfermería).
 * Norma: TDR §7 / MINSAL Acuerdo n.° 1616 (2024).
 *
 * ---------------------------------------------------------------------------
 * MAPPING BD real (resuelto HD-22)
 * ---------------------------------------------------------------------------
 *   ece.registro_enfermeria:
 *     id, instancia_id, episodio_id, turno, nota_evolucion, plan_cuidados,
 *     valoracion_enf (jsonb), registrado_por (uuid), registrado_en, estado_registro
 *     — SIN: fecha, organization_id, personal_id, firmado_por, firmado_en
 *
 *   ece.administracion_medicamento:
 *     id, registro_enf_id, indicacion_item_id, hora_programada (timestamptz),
 *     hora_aplicada (timestamptz), estado (text), motivo_omision, responsable (uuid)
 *     — SIN: registro_id, hora_administrada, dosis_administrada, via_usada
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (código tipo: REG_ENF)
 * ---------------------------------------------------------------------------
 *   borrador    → en_revision  (NURSE: completar turno)
 *   en_revision → firmado      (NURSE: firma al final de turno)
 *   firmado     → validado     (NURSE coordinadora: cierre formal)
 *
 * ---------------------------------------------------------------------------
 * HD-23 (P1): scheduledSlot
 * ---------------------------------------------------------------------------
 *   registrarAdministracion deriva hora_programada usando computeScheduledSlot
 *   a partir de ece.indicacion_item.hora_indicada + frequencia.
 *   Sin este slot la conciliación de omisiones (MISSED) es imposible.
 *
 * ---------------------------------------------------------------------------
 * HD-24 (P1): RLS / filtro tenant
 * ---------------------------------------------------------------------------
 *   list usa withEceContext (demota a `authenticated` → RLS aplica) y filtra
 *   por episodio_id en lugar de organization_id (columna que no existe en BD).
 *
 * ---------------------------------------------------------------------------
 * OUTBOX
 * ---------------------------------------------------------------------------
 *   'ece.administracion.registrada'  — Stream 30.
 *   Payload: { administracionId, registroEnfId, indicacionItemId,
 *              episodioId, enfermeraId, horaProgramada }
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { emitDomainEvent } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../workflow/context";
import { applyGs1Validation } from "../../gs1/require-gs1-validation";
import { computeScheduledSlot } from "../../utils/medication-slot";
import type { TenantContext } from "@his/contracts";
import type { PrismaClient } from "@prisma/client";
import { validateClinicalText } from "@his/contracts/clinical/forbidden-abbreviations";

// ---------------------------------------------------------------------------
// Schemas Zod — espejo de packages/contracts/src/schemas/ece-registro-enfermeria.ts
// Se definen aquí porque el paquete contracts se resuelve desde el monorepo raíz
// en contexto de worktree y puede no incluir el export del nuevo schema.
// ---------------------------------------------------------------------------

export const turnoEnum = z.enum(["matutino", "vespertino", "nocturno"]);

const eceRegistroCreateSchema = z.object({
  episodioId: z.string().uuid(),
  turno: turnoEnum,
  notaEvolucion: z.string().trim().max(2000).optional(),
  planCuidados: z.string().trim().max(4000).optional(),
  valoracionEnf: z.record(z.unknown()).optional(),
});

const eceAdministracionSchema = z.object({
  registroEnfId: z.string().uuid(),
  indicacionItemId: z.string().uuid(),
  horaAplicada: z.coerce.date(),
  estado: z.enum(["administrado", "omitido", "pospuesto"]).default("administrado"),
  motivoOmision: z.string().trim().max(500).optional(),
  gs1: z.object({
    gtin: z.string().min(8).max(14),
    lote: z.string().min(1).max(80),
    expiry: z.coerce.date(),
    pacienteId: z.string().uuid(),
    pacienteGsrn: z.string().length(18).optional(),
    episodioId: z.string().uuid().optional(),
    dosis: z.string().min(1).max(100).optional(),
    via: z.string().min(1).max(80).optional(),
  }).optional(),
});

const eceRegistroListSchema = z.object({
  episodioId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const eceRegistroGetSchema = z.object({ id: z.string().uuid() });
const eceRegistroIdSchema   = z.object({ id: z.string().uuid() });

// SBAR — JCI IPSG.2 ME 4
// Definido localmente para que el router sea autocontenido y no dependa de
// que el build de @his/contracts esté actualizado en el monorepo.
const sbarFieldSchema = z.string().trim().min(10).max(2000);

const sbarSchema = z.object({
  situation:      sbarFieldSchema,
  background:     sbarFieldSchema,
  assessment:     sbarFieldSchema,
  recommendation: sbarFieldSchema,
});

const eceCierreSchema = z.object({
  id: z.string().uuid(),
  sbar: sbarSchema.optional(),
});

// ---------------------------------------------------------------------------
// Tipos raw SQL
// ---------------------------------------------------------------------------

export interface RegistroRow {
  id: string;
  instancia_id: string;
  episodio_id: string;
  turno: string;
  nota_evolucion: string | null;
  plan_cuidados: string | null;
  valoracion_enf: Record<string, unknown> | null;
  sbar: Record<string, string> | null;
  registrado_por: string;
  registrado_en: Date;
  estado_registro: string;
}

export interface IndicacionItemRow {
  id: string;
  estado: string;
  episodio_id: string;
  hora_indicada: Date | null;
  frequencia: string | null;
}

// ---------------------------------------------------------------------------
// Helper de contexto ECE
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

// ---------------------------------------------------------------------------
// Helpers de consulta raw
// ---------------------------------------------------------------------------

/**
 * Busca un registro de enfermería por id.
 * HD-24: filtra por episodio→establecimiento en lugar de organization_id
 * (columna inexistente en BD). Ejecutar dentro de withEceContext.
 */
async function findRegistro(
  prisma: Pick<PrismaClient, "$queryRaw">,
  id: string,
  orgId: string,
): Promise<RegistroRow | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<RegistroRow[]>)`
    SELECT re.id, re.instancia_id, re.episodio_id, re.turno,
           re.nota_evolucion, re.plan_cuidados, re.valoracion_enf,
           re.sbar,
           re.registrado_por, re.registrado_en, re.estado_registro
    FROM ece.registro_enfermeria re
    JOIN ece.episodio_atencion ea ON ea.id = re.episodio_id
    WHERE re.id = ${id}::uuid
      AND ea.establecimiento_id IN (
        SELECT id FROM public."Organization"
        WHERE "parentId"::text = ${orgId}
           OR id::text = ${orgId}
      )
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Busca indicacion_item con hora_indicada + frequencia para derivar scheduledSlot.
 */
async function findIndicacionItem(
  prisma: Pick<PrismaClient, "$queryRaw">,
  id: string,
  orgId: string,
): Promise<IndicacionItemRow | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<IndicacionItemRow[]>)`
    SELECT ii.id, ii.estado, i.episodio_id,
           ii.hora_indicada, ii.frequencia
    FROM ece.indicacion_item ii
    JOIN ece.indicacion i ON i.id = ii.indicacion_id
    JOIN ece.episodio_atencion ea ON ea.id = i.episodio_id
    WHERE ii.id = ${id}::uuid
      AND ea.establecimiento_id IN (
        SELECT id FROM public."Organization"
        WHERE "parentId"::text = ${orgId}
           OR id::text = ${orgId}
      )
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const nurseRole = requireRole(["NURSE"]);

export const registroEnfermeriaRouter = router({
  /**
   * Lista registros de jornada.
   * HD-24: withEceContext → RLS aplica; filtra por episodio_id (no organization_id).
   */
  list: nurseRole
    .input(eceRegistroListSchema)
    .query(async ({ ctx, input }) => {
      return withEceContext(ctx.prisma, ctx.tenant, ctx.user.id, async (tx) => {
        return (tx.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<RegistroRow[]>)`
          SELECT re.id, re.instancia_id, re.episodio_id, re.turno,
                 re.nota_evolucion, re.plan_cuidados, re.valoracion_enf,
                 re.sbar,
                 re.registrado_por, re.registrado_en, re.estado_registro
          FROM ece.registro_enfermeria re
          WHERE (${input.episodioId ?? null}::uuid IS NULL
                 OR re.episodio_id = ${input.episodioId ?? null}::uuid)
          ORDER BY re.registrado_en DESC
          LIMIT ${input.limit}
        `;
      });
    }),

  /** Obtiene un registro de jornada por id. */
  get: nurseRole
    .input(eceRegistroGetSchema)
    .query(async ({ ctx, input }) => {
      const row = await withEceContext(
        ctx.prisma,
        ctx.tenant,
        ctx.user.id,
        async (tx) => findRegistro(tx, input.id, ctx.tenant.organizationId),
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /**
   * Crea la cabecera del registro de jornada (estado inicial: borrador).
   * HD-22: INSERT usa columnas BD reales. Sin fecha, organization_id, personal_id.
   */
  create: nurseRole
    .input(eceRegistroCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        const rows = await (tx.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string }>>)`
          INSERT INTO ece.registro_enfermeria
            (episodio_id, turno, nota_evolucion, plan_cuidados,
             valoracion_enf, registrado_por, registrado_en, estado_registro)
          VALUES
            (${input.episodioId}::uuid,
             ${input.turno},
             ${input.notaEvolucion ?? null},
             ${input.planCuidados ?? null},
             ${input.valoracionEnf ? JSON.stringify(input.valoracionEnf) : null}::jsonb,
             ${userId}::uuid,
             now(),
             'borrador')
          RETURNING id
        `;
        const created = rows[0];
        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No se pudo crear el registro de enfermería.",
          });
        }
        return { id: created.id };
      });
    }),

  /**
   * Agrega una fila a ece.administracion_medicamento.
   *
   * HD-23 (P1): deriva hora_programada via computeScheduledSlot usando
   *   indicacion_item.hora_indicada + frequencia.
   *
   * HD-22: INSERT usa columnas BD reales: registro_enf_id, hora_aplicada, responsable.
   */
  registrarAdministracion: nurseRole
    .input(eceAdministracionSchema)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      // Todas las queries en un único withEceContext para minimizar transacciones
      // y mantener la secuencia de $queryRaw predecible para tests.
      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        const registro = await findRegistro(tx, input.registroEnfId, orgId);
        if (!registro) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Registro de enfermería no encontrado.",
          });
        }

        const indicacion = await findIndicacionItem(tx, input.indicacionItemId, orgId);
        if (!indicacion) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La indicación referenciada no existe en la organización.",
          });
        }
        if (indicacion.estado === "anulada") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No se puede registrar administración sobre una indicación anulada.",
          });
        }

        // HD-23: slot programado desde la indicación médica.
        // Fallback a horaAplicada si no hay hora_indicada o frequencia disponibles.
        const horaProgramada: Date =
          indicacion.hora_indicada !== null && indicacion.frequencia !== null
            ? computeScheduledSlot(indicacion.hora_indicada, indicacion.frequencia, input.horaAplicada)
            : input.horaAplicada;

        if (input.gs1) {
          await applyGs1Validation(ctx, {
            ...input.gs1,
            dosis: input.gs1.dosis ?? "",
            via: input.gs1.via ?? "",
            hora: input.horaAplicada,
            indicacionItemId: input.indicacionItemId,
          });
        }

        const rows = await (tx.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string }>>)`
          INSERT INTO ece.administracion_medicamento
            (registro_enf_id, indicacion_item_id, hora_programada,
             hora_aplicada, estado, motivo_omision, responsable)
          VALUES
            (${input.registroEnfId}::uuid,
             ${input.indicacionItemId}::uuid,
             ${horaProgramada}::timestamptz,
             ${input.horaAplicada}::timestamptz,
             ${input.estado},
             ${input.motivoOmision ?? null},
             ${userId}::uuid)
          RETURNING id
        `;
        const created = rows[0];
        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No se pudo registrar la administración.",
          });
        }

        await emitDomainEvent(tx as unknown as PrismaClient, {
          organizationId: orgId,
          eventType: "ece.administracion.registrada",
          aggregateType: "AdministracionMedicamento",
          aggregateId: created.id,
          emittedById: userId,
          payload: {
            administracionId: created.id,
            registroEnfId: input.registroEnfId,
            indicacionItemId: input.indicacionItemId,
            episodioId: indicacion.episodio_id,
            enfermeraId: userId,
            horaProgramada: horaProgramada.toISOString(),
          },
        });

        return { id: created.id };
      });
    }),

  /**
   * Firma el registro de jornada.
   * HD-22: UPDATE usa estado_registro; sin firmado_por (no existe en BD).
   */
  firmar: nurseRole
    .input(eceRegistroIdSchema)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        const registro = await findRegistro(tx, input.id, orgId);
        if (!registro) throw new TRPCError({ code: "NOT_FOUND" });

        if (!["borrador", "en_revision"].includes(registro.estado_registro)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No se puede firmar un registro en estado '${registro.estado_registro}'.`,
          });
        }

        // JCI IPSG.2 ME 3 — validación abreviaciones prohibidas (warning, no bloquea)
        const textoEvolucion = [
          registro.nota_evolucion ?? "",
          registro.plan_cuidados ?? "",
        ].join(" ");
        const ipsg2 = validateClinicalText(textoEvolucion);
        if (ipsg2.errors.length > 0 || ipsg2.warnings.length > 0) {
          console.warn(
            `[IPSG.2 ME 3] registro_enfermeria ${input.id}: ` +
              `${ipsg2.errors.length} error(es) JCI, ${ipsg2.warnings.length} warning(s)`,
          );
        }

        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.registro_enfermeria
          SET estado_registro = 'firmado'
          WHERE id = ${input.id}::uuid
        `;
        return {
          ok: true as const,
          ipsg2Warnings: [...ipsg2.errors, ...ipsg2.warnings],
        };
      });
    }),

  /**
   * Cierra el turno de enfermería con handoff SBAR opcional.
   *
   * JCI Standard: IPSG.2 ME 4 — structured handoff.
   *
   * Flujo:
   *   borrador | en_revision → cierre_turno
   *
   * Si sbar es null y el episodio está activo (no dado de alta), la respuesta
   * incluye un warning pero el cierre procede — el estándar JCI recomienda pero
   * la norma local no lo hace obligatorio (enfermeras en urgencias pueden cerrar
   * sin handoff formal cuando no hay enfermero entrante aún).
   *
   * Una vez cerrado el turno, el registro avanza a estado 'en_revision' para
   * que la firma posterior sea posible.
   */
  cerrarTurno: nurseRole
    .input(eceCierreSchema)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        const registro = await findRegistro(tx, input.id, orgId);
        if (!registro) throw new TRPCError({ code: "NOT_FOUND" });

        if (!["borrador", "en_revision"].includes(registro.estado_registro)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No se puede cerrar un turno en estado '${registro.estado_registro}'.`,
          });
        }

        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.registro_enfermeria
          SET estado_registro = 'en_revision',
              sbar            = ${input.sbar ? JSON.stringify(input.sbar) : null}::jsonb
          WHERE id = ${input.id}::uuid
        `;

        // Warning cuando el paciente sigue activo y no se registró SBAR.
        // El episodio activo se infiere por la existencia del registro_enfermeria
        // en estado que no sea 'validado' o 'cerrado'.
        const sbarMissing = input.sbar == null;

        return {
          ok: true as const,
          ...(sbarMissing && {
            warning:
              "SBAR no registrado. JCI IPSG.2 ME 4 recomienda handoff estructurado " +
              "al cierre de turno cuando el paciente permanece activo.",
          }),
        };
      });
    }),

  /**
   * Valida el registro de jornada.
   * HD-22: UPDATE usa estado_registro; sin validado_por/validado_en (no existen en BD).
   */
  validar: nurseRole
    .input(eceRegistroIdSchema)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        const registro = await findRegistro(tx, input.id, orgId);
        if (!registro) throw new TRPCError({ code: "NOT_FOUND" });

        if (registro.estado_registro !== "firmado") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se puede validar un registro en estado 'firmado'. Estado actual: '${registro.estado_registro}'.`,
          });
        }

        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.registro_enfermeria
          SET estado_registro = 'validado'
          WHERE id = ${input.id}::uuid
        `;
        return { ok: true as const };
      });
    }),
});
