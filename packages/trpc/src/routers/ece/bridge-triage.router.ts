/**
 * Bridge ECE ↔ HIS Triage (Fase 2, Stream 18-ext).
 *
 * Norma técnica: NTEC Doc 4 (MINSAL) — Hoja de Triaje ECE formal.
 * Gestiona el vínculo entre TriageEvaluation HIS (Manchester) y ece.triaje
 * (hoja formal ECE), con firma electrónica del enfermero (ENF) opcional.
 *
 * Procedures:
 *   eceBridgeTriage.linkTriage          — vincula Triage HIS ↔ EceTriaje existente.
 *   eceBridgeTriage.unlinkTriage        — elimina el vínculo (borra el campo en data JSON).
 *   eceBridgeTriage.createEceFromTriage — crea EceTriaje desde TriageEvaluation HIS completada.
 *   eceBridgeTriage.syncCompletedTriages — job manual: procesa Triages COMPLETED sin ECE.
 *
 * Estrategia de vínculo:
 *   EceTriaje no tiene FK directa a TriageEvaluation (esquemas distintos,
 *   evolución independiente). El vínculo se guarda en:
 *     - ece.triaje.data->>'hisTriageEvalId'  (persistido en ECE)
 *   La consulta inversa usa este campo JSON para lookups.
 *
 * Firma electrónica:
 *   Si firmarInmediatamente=true y el rol del usuario incluye ENF,
 *   estado_registro = 'firmado'. En cualquier otro caso: 'borrador'.
 *
 * Outbox:
 *   emite ece.triaje.linkedToHisTriage dentro de la transacción Prisma.
 *
 * Roles:
 *   requireRole(["NURSE","PHYSICIAN"])
 */
import { TRPCError } from "@trpc/server";
import { emitDomainEvent } from "@his/database";
import { router, requireRole } from "../../trpc";
import {
  linkTriageInput,
  unlinkTriageInput,
  createEceFromTriageInput,
  syncCompletedTriagesInput,
  MANCHESTER_TO_ECE_NIVEL,
} from "@his/contracts";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos para filas raw SQL (ece.triaje)
// ─────────────────────────────────────────────────────────────────────────────

type EceTriajeRow = {
  id: string;
  episodio_id: string;
  nivel_prioridad: string;
  estado_registro: string;
  data: Record<string, unknown> | null;
};

type HisTriajeCompletedRow = {
  id: string;
  patient_id: string;
  assigned_level_priority: number;
  motivo_consulta: string | null;
  completed_at: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers SQL (ECE usa raw SQL — fuera del schema Prisma principal)
// ─────────────────────────────────────────────────────────────────────────────

type RawClient = {
  $queryRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown>;
  $executeRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown>;
};

/**
 * Obtiene la fila ece.triaje por id, verificando que el data JSON no tenga
 * ya un hisTriageEvalId distinto (prevent double-link).
 */
async function fetchEceTriaje(
  prisma: RawClient,
  eceTriajeId: string,
): Promise<EceTriajeRow | null> {
  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<EceTriajeRow[]>)`
    SELECT id, episodio_id, nivel_prioridad, estado_registro, data
    FROM ece.triaje
    WHERE id = ${eceTriajeId}::uuid
      AND estado_registro != 'anulado'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Escribe el campo hisTriageEvalId en data JSON de ece.triaje.
 * Usa jsonb_set para no sobreescribir otros campos del JSONB.
 */
async function setHisLink(
  prisma: RawClient,
  eceTriajeId: string,
  hisTriageId: string | null,
): Promise<void> {
  if (hisTriageId === null) {
    await (prisma.$executeRaw as (
      tpl: TemplateStringsArray,
      ...vals: unknown[]
    ) => Promise<number>)`
      UPDATE ece.triaje
      SET data = data - 'hisTriageEvalId'
      WHERE id = ${eceTriajeId}::uuid
    `;
  } else {
    await (prisma.$executeRaw as (
      tpl: TemplateStringsArray,
      ...vals: unknown[]
    ) => Promise<number>)`
      UPDATE ece.triaje
      SET data = jsonb_set(
            COALESCE(data, '{}'),
            '{hisTriageEvalId}',
            ${JSON.stringify(hisTriageId)}::jsonb
          )
      WHERE id = ${eceTriajeId}::uuid
    `;
  }
}

/**
 * Inserta una fila nueva en ece.triaje y retorna su id.
 */
async function insertEceTriaje(
  prisma: RawClient,
  opts: {
    episodioId: string;
    pacienteId: string | null;
    motivo: string | null;
    nivelPrioridad: string;
    destinoAsignado: string | null;
    signosVitalesId: string | null;
    registradoPorId: string;
    estadoRegistro: "borrador" | "firmado";
    hisTriageId: string;
  },
): Promise<string> {
  const dataJson = JSON.stringify({ hisTriageEvalId: opts.hisTriageId });

  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<Array<{ id: string }>>)`
    INSERT INTO ece.triaje (
      episodio_id,
      paciente_id,
      motivo,
      nivel_prioridad,
      destino_asignado,
      signos_vitales_id,
      registrado_por,
      estado_registro,
      data
    ) VALUES (
      ${opts.episodioId}::uuid,
      ${opts.pacienteId}::uuid,
      ${opts.motivo},
      ${opts.nivelPrioridad},
      ${opts.destinoAsignado},
      ${opts.signosVitalesId ?? null}::uuid,
      ${opts.registradoPorId}::uuid,
      ${opts.estadoRegistro},
      ${dataJson}::jsonb
    )
    RETURNING id
  `;

  const id = rows[0]?.id;
  if (!id) throw new Error("INSERT ece.triaje no devolvió id");
  return id;
}

/**
 * Triages HIS COMPLETED sin vínculo ECE (data en TriageEvaluation no incluye
 * el id ECE — la señal de ausencia es simplemente que ece.triaje no tiene
 * ninguna fila con data->>'hisTriageEvalId' = ese id).
 */
async function fetchCompletedUnlinkedTriages(
  prisma: RawClient,
  organizationId: string,
  limit: number,
): Promise<HisTriajeCompletedRow[]> {
  // JOIN con TriageLevel para extraer el priority (Manchester 1-5).
  return await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<HisTriajeCompletedRow[]>)`
    SELECT
      te.id,
      te.patient_id,
      tl.priority AS assigned_level_priority,
      ev.chief_complaint AS motivo_consulta,
      te.completed_at
    FROM public."TriageEvaluation" te
    JOIN public."TriageLevel" tl ON tl.id = te.assigned_level_id
    LEFT JOIN public."EmergencyVisit" ev ON ev.triage_evaluation_id = te.id
    WHERE te.organization_id = ${organizationId}::uuid
      AND te.status = 'COMPLETED'
      AND NOT EXISTS (
        SELECT 1 FROM ece.triaje t
        WHERE t.data->>'hisTriageEvalId' = te.id::text
          AND t.estado_registro != 'anulado'
      )
    ORDER BY te.completed_at DESC
    LIMIT ${limit}
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

const nurseProcedure = requireRole(["NURSE", "PHYSICIAN"]);

export const eceBridgeTriageRouter = router({
  /**
   * Vincula un TriageEvaluation HIS ya existente a una EceTriaje ya existente.
   * Guarda el id en ece.triaje.data->>'hisTriageEvalId' y emite outbox.
   */
  linkTriage: nurseProcedure
    .input(linkTriageInput)
    .mutation(async ({ ctx, input }) => {
      // Verificar que el TriageEvaluation pertenece al tenant.
      const hisTriaje = await ctx.prisma.triageEvaluation.findFirst({
        where: {
          id: input.triageId,
          organizationId: ctx.tenant.organizationId,
        },
        include: { assignedLevel: true },
      });
      if (!hisTriaje) {
        throw new TRPCError({ code: "NOT_FOUND", message: "TriageEvaluation no encontrado." });
      }

      // Verificar que la EceTriaje existe.
      const eceTriaje = await fetchEceTriaje(ctx.prisma, input.eceTriajeId);
      if (!eceTriaje) {
        throw new TRPCError({ code: "NOT_FOUND", message: "EceTriaje no encontrada o anulada." });
      }

      // Prevenir doble vínculo con un Triage HIS distinto.
      const existing = eceTriaje.data?.["hisTriageEvalId"] as string | undefined;
      if (existing && existing !== input.triageId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `EceTriaje ya vinculada al TriageEvaluation ${existing}.`,
        });
      }

      const manchesterLevel = hisTriaje.assignedLevel.priority;
      const firmadoInmediatamente = false;

      await ctx.prisma.$transaction(async (tx) => {
        await setHisLink(
          tx as unknown as RawClient,
          input.eceTriajeId,
          input.triageId,
        );

        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.triaje.linkedToHisTriage",
          aggregateType: "EceTriaje",
          aggregateId: input.eceTriajeId,
          emittedById: ctx.user.id,
          payload: {
            hisTriageId: input.triageId,
            eceTriajeId: input.eceTriajeId,
            patientId: hisTriaje.patientId,
            manchesterLevel,
            firmadoInmediatamente,
            byUserId: ctx.user.id,
          },
        });
      });

      return {
        ok: true as const,
        eceTriajeId: input.eceTriajeId,
        hisTriageId: input.triageId,
      };
    }),

  /**
   * Elimina el vínculo HIS de una EceTriaje (borrar hisTriageEvalId de data).
   * No elimina la EceTriaje ni la TriageEvaluation.
   */
  unlinkTriage: nurseProcedure
    .input(unlinkTriageInput)
    .mutation(async ({ ctx, input }) => {
      // Buscar el EceTriaje vinculado al Triage HIS dado.
      const rows = await (ctx.prisma.$queryRaw as (
        tpl: TemplateStringsArray,
        ...vals: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        SELECT id
        FROM ece.triaje
        WHERE data->>'hisTriageEvalId' = ${input.triageId}
          AND estado_registro != 'anulado'
        LIMIT 1
      `;

      const eceTriajeId = rows[0]?.id ?? null;
      if (!eceTriajeId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No se encontró ninguna EceTriaje vinculada a ese TriageEvaluation.",
        });
      }

      await setHisLink(ctx.prisma, eceTriajeId, null);

      return { ok: true as const, eceTriajeId };
    }),

  /**
   * Crea una EceTriaje a partir de un TriageEvaluation HIS (COMPLETED o IN_PROGRESS).
   * - Mapea priority Manchester 1-5 → nivelPrioridad ECE ("I"–"V").
   * - Estado: "firmado" si firmarInmediatamente=true y rol ENF; "borrador" en otro caso.
   * - Vincula automáticamente y emite outbox.
   */
  createEceFromTriage: nurseProcedure
    .input(createEceFromTriageInput)
    .mutation(async ({ ctx, input }) => {
      // Verificar que la TriageEvaluation pertenece al tenant.
      const hisTriaje = await ctx.prisma.triageEvaluation.findFirst({
        where: {
          id: input.triageId,
          organizationId: ctx.tenant.organizationId,
        },
        include: {
          assignedLevel: true,
          patient: { select: { id: true } },
        },
      });

      if (!hisTriaje) {
        throw new TRPCError({ code: "NOT_FOUND", message: "TriageEvaluation no encontrado." });
      }

      // Verificar idempotencia: si ya existe un ECE vinculado, retornar el existente.
      const existingRows = await (ctx.prisma.$queryRaw as (
        tpl: TemplateStringsArray,
        ...vals: unknown[]
      ) => Promise<Array<{ id: string; estado_registro: string; nivel_prioridad: string }>>)`
        SELECT id, estado_registro, nivel_prioridad
        FROM ece.triaje
        WHERE data->>'hisTriageEvalId' = ${input.triageId}
          AND estado_registro != 'anulado'
        LIMIT 1
      `;

      if (existingRows[0]) {
        return {
          ok: true as const,
          eceTriajeId: existingRows[0].id,
          hisTriageId: input.triageId,
          estadoRegistro: existingRows[0].estado_registro as "borrador" | "firmado",
          nivelPrioridad: existingRows[0].nivel_prioridad,
        };
      }

      const manchesterLevel = hisTriaje.assignedLevel.priority;
      const nivelPrioridad = MANCHESTER_TO_ECE_NIVEL[manchesterLevel] ?? "III";

      // El rol ENF puede firmar inmediatamente.
      const isNurse = ctx.tenant.roleCodes.includes("NURSE");
      const firmadoInmediatamente = input.firmarInmediatamente && isNurse;
      const estadoRegistro: "borrador" | "firmado" = firmadoInmediatamente
        ? "firmado"
        : "borrador";

      let eceTriajeId: string;

      await ctx.prisma.$transaction(async (tx) => {
        eceTriajeId = await insertEceTriaje(tx as unknown as RawClient, {
          episodioId: input.episodioId,
          pacienteId: hisTriaje.patient.id,
          motivo: null, // motivo viene de la evaluación — dejar en null para que enfermero complete
          nivelPrioridad,
          destinoAsignado: input.destinoAsignado ?? null,
          signosVitalesId: input.signosVitalesId ?? null,
          registradoPorId: input.registradoPorId,
          estadoRegistro,
          hisTriageId: input.triageId,
        });

        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.triaje.linkedToHisTriage",
          aggregateType: "EceTriaje",
          aggregateId: eceTriajeId!,
          emittedById: ctx.user.id,
          payload: {
            hisTriageId: input.triageId,
            eceTriajeId: eceTriajeId!,
            patientId: hisTriaje.patient.id,
            manchesterLevel,
            firmadoInmediatamente,
            byUserId: ctx.user.id,
          },
        });
      });

      return {
        ok: true as const,
        eceTriajeId: eceTriajeId!,
        hisTriageId: input.triageId,
        estadoRegistro,
        nivelPrioridad,
      };
    }),

  /**
   * Job manual: encuentra TriageEvaluations COMPLETED sin Hoja ECE vinculada
   * y crea la EceTriaje en estado borrador para revisión posterior.
   *
   * Diseñado para ejecutarse de forma controlada por un operador/admin.
   * Itera hasta `limit` registros; errores por fila se cuentan pero no
   * abortan el lote (fail-soft para resiliencia operativa).
   */
  syncCompletedTriages: nurseProcedure
    .input(syncCompletedTriagesInput)
    .mutation(async ({ ctx, input }) => {
      const unlinked = await fetchCompletedUnlinkedTriages(
        ctx.prisma,
        ctx.tenant.organizationId,
        input.limit,
      );

      let processed = 0;
      let errors = 0;
      const details: Array<{
        triageId: string;
        status: "created" | "skipped" | "error";
        eceTriajeId?: string;
        reason?: string;
      }> = [];

      for (const row of unlinked) {
        const manchesterLevel = row.assigned_level_priority;
        const nivelPrioridad = MANCHESTER_TO_ECE_NIVEL[manchesterLevel] ?? "III";

        if (!input.defaultEpisodioId) {
          // Sin episodio por defecto no es posible crear la EceTriaje.
          details.push({ triageId: row.id, status: "skipped", reason: "defaultEpisodioId requerido" });
          continue;
        }

        try {
          let eceTriajeId: string;

          await ctx.prisma.$transaction(async (tx) => {
            eceTriajeId = await insertEceTriaje(tx as unknown as RawClient, {
              episodioId: input.defaultEpisodioId!,
              pacienteId: row.patient_id,
              motivo: row.motivo_consulta,
              nivelPrioridad,
              destinoAsignado: null,
              signosVitalesId: null,
              registradoPorId: input.registradoPorId,
              estadoRegistro: "borrador",
              hisTriageId: row.id,
            });

            await emitDomainEvent(tx, {
              organizationId: ctx.tenant.organizationId,
              eventType: "ece.triaje.linkedToHisTriage",
              aggregateType: "EceTriaje",
              aggregateId: eceTriajeId!,
              emittedById: ctx.user.id,
              payload: {
                hisTriageId: row.id,
                eceTriajeId: eceTriajeId!,
                patientId: row.patient_id,
                manchesterLevel,
                firmadoInmediatamente: false,
                byUserId: ctx.user.id,
              },
            });
          });

          details.push({ triageId: row.id, status: "created", eceTriajeId: eceTriajeId! });
          processed++;
        } catch (err) {
          errors++;
          const msg = err instanceof Error ? err.message : String(err);
          details.push({ triageId: row.id, status: "error", reason: msg });
        }
      }

      return { processed, errors, details };
    }),
});
