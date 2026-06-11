/**
 * Router tRPC — Bridge ECE ↔ HIS Triage (Stream 18-ext).
 *
 * Documento NTEC: Doc 4 — Hoja de Triaje ECE formal (MINSAL Acuerdo n.° 1616-2024).
 * Código de operación: ECE-BRIDGE-TRIAGE.
 * Gestiona el vínculo bidireccional entre TriageEvaluation HIS (schema public,
 *   escala Manchester) y ece.hoja_triaje (documento ECE formal en schema ece).
 * Coexistencia planificada: en la transición HIS→ECE, el triaje puede registrarse
 *   en el sistema HIS y luego promovido al expediente ECE formal.
 *
 * ---------------------------------------------------------------------------
 * OPERACIONES
 * ---------------------------------------------------------------------------
 *   linkTriage            — vincula TriageEvaluation HIS existente ↔ EceTriaje existente.
 *   unlinkTriage          — elimina el vínculo (SET NULL en ece.triaje.data JSONB).
 *   createEceFromTriage   — crea ece.hoja_triaje desde TriageEvaluation HIS completada.
 *                           Si firmarInmediatamente=true y rol incluye ENF →
 *                           estado_registro='firmado'. Sino → 'borrador'.
 *   syncCompletedTriages  — job manual: procesa todas las TriageEvaluation COMPLETED
 *                           que no tienen ece.hoja_triaje asociada (backfill).
 *
 * ---------------------------------------------------------------------------
 * ESTRATEGIA DE VÍNCULO
 * ---------------------------------------------------------------------------
 *   ece.hoja_triaje NO tiene FK directa a public."TriageEvaluation" (schemas
 *   de evolución independiente). El vínculo se persiste como JSONB:
 *     ece.hoja_triaje.data->>'hisTriageEvalId'
 *   La consulta inversa usa el operador @> de JSONB o extracción por campo.
 *   Decisión deliberada: flexibilidad ante cambios de schema HIS sin migración ECE.
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro de Prisma.$transaction)
 * ---------------------------------------------------------------------------
 *   'ece.triaje.linkedToHisTriage'  — emitido por linkTriage y createEceFromTriage.
 *     Payload: { eceTriajeId, hisTriageEvalId, enfermeroId, orgId }
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* + Prisma para public.*)
 * ---------------------------------------------------------------------------
 *   ece.hoja_triaje (via raw SQL)        — data JSONB contiene hisTriageEvalId
 *   public."TriageEvaluation" (via Prisma ORM) — evaluación HIS de origen
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   linkTriage, unlinkTriage          → requireRole(["NURSE","PHYSICIAN"])
 *   createEceFromTriage               → requireRole(["NURSE","PHYSICIAN"])
 *   syncCompletedTriages              → requireRole(["NURSE","PHYSICIAN"])
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
// Tipos para filas raw SQL (ece.hoja_triaje — tabla real)
// ─────────────────────────────────────────────────────────────────────────────

type EceTriajeRow = {
  id: string;
  instancia_id: string;
  episodio_id: string;
  nivel_prioridad: string;
  estado_registro: string;
  // hoja_triaje no tiene columna data JSONB; el vínculo HIS se almacena en evaluacion_triaje JSONB.
  evaluacion_triaje: Record<string, unknown> | null;
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
  // Tabla real: ece.hoja_triaje. estado_registro CHECK: vigente|rectificado (no 'anulado').
  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<EceTriajeRow[]>)`
    SELECT id, instancia_id, episodio_id, nivel_prioridad, estado_registro, evaluacion_triaje
    FROM ece.hoja_triaje
    WHERE id = ${eceTriajeId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Escribe el campo hisTriageEvalId en evaluacion_triaje JSONB de ece.hoja_triaje.
 * hoja_triaje no tiene columna 'data'; el campo de vínculo va en evaluacion_triaje.
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
      UPDATE ece.hoja_triaje
      SET evaluacion_triaje = evaluacion_triaje - 'hisTriageEvalId'
      WHERE id = ${eceTriajeId}::uuid
    `;
  } else {
    await (prisma.$executeRaw as (
      tpl: TemplateStringsArray,
      ...vals: unknown[]
    ) => Promise<number>)`
      UPDATE ece.hoja_triaje
      SET evaluacion_triaje = jsonb_set(
            COALESCE(evaluacion_triaje, '{}'),
            '{hisTriageEvalId}',
            ${JSON.stringify(hisTriageId)}::jsonb
          )
      WHERE id = ${eceTriajeId}::uuid
    `;
  }
}

/**
 * Inserta una fila nueva en ece.hoja_triaje y retorna su id.
 *
 * instancia_id es NOT NULL → sigue el patrón instancia-first:
 * el llamador ya creó el documento_instancia TRIAJE y pasa su id.
 * estado_registro CHECK: vigente|rectificado (no borrador/firmado).
 * El estado de workflow vive en documento_instancia.estado_actual_id.
 */
async function insertEceTriaje(
  prisma: RawClient,
  opts: {
    instanciaId: string;
    episodioId: string;
    motivoConsulta: string | null;
    nivelPrioridad: string;
    destinoAsignado: string | null;
    signosVitalesId: string | null;
    registradoPorId: string;
    hisTriageId: string;
  },
): Promise<string> {
  // El vínculo HIS se guarda en evaluacion_triaje JSONB (no hay columna 'data').
  const evaluacionJson = JSON.stringify({ hisTriageEvalId: opts.hisTriageId });

  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<Array<{ id: string }>>)`
    INSERT INTO ece.hoja_triaje (
      instancia_id,
      episodio_id,
      motivo_consulta,
      nivel_prioridad,
      destino_asignado,
      signos_vitales_id,
      registrado_por,
      estado_registro,
      evaluacion_triaje
    ) VALUES (
      ${opts.instanciaId}::uuid,
      ${opts.episodioId}::uuid,
      ${opts.motivoConsulta},
      ${opts.nivelPrioridad},
      ${opts.destinoAsignado},
      ${opts.signosVitalesId ?? null}::uuid,
      ${opts.registradoPorId}::uuid,
      'vigente',
      ${evaluacionJson}::jsonb
    )
    RETURNING id
  `;

  const id = rows[0]?.id;
  if (!id) throw new Error("INSERT ece.hoja_triaje no devolvió id");
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
  // Vínculo inverso: busca hoja_triaje donde evaluacion_triaje->>'hisTriageEvalId' coincide.
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
        SELECT 1 FROM ece.hoja_triaje ht
        WHERE ht.evaluacion_triaje->>'hisTriageEvalId' = te.id::text
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
      const existing = eceTriaje.evaluacion_triaje?.["hisTriageEvalId"] as string | undefined;
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
        FROM ece.hoja_triaje
        WHERE evaluacion_triaje->>'hisTriageEvalId' = ${input.triageId}
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
        FROM ece.hoja_triaje
        WHERE evaluacion_triaje->>'hisTriageEvalId' = ${input.triageId}
        LIMIT 1
      `;

      if (existingRows[0]) {
        return {
          ok: true as const,
          eceTriajeId: existingRows[0].id,
          hisTriageId: input.triageId,
          // estado_registro CHECK: vigente|rectificado. El estado workflow vive en documento_instancia.
          estadoRegistro: existingRows[0].estado_registro as "vigente" | "rectificado",
          nivelPrioridad: existingRows[0].nivel_prioridad,
        };
      }

      const manchesterLevel = hisTriaje.assignedLevel.priority;
      const nivelPrioridad = MANCHESTER_TO_ECE_NIVEL[manchesterLevel] ?? "III";

      // El rol ENF puede firmar inmediatamente.
      const isNurse = ctx.tenant.roleCodes.includes("NURSE");
      const firmadoInmediatamente = input.firmarInmediatamente && isNurse;
      // estado_registro siempre 'vigente' (CHECK BD: vigente|rectificado).
      // El estado de workflow (borrador→firmado) vive en documento_instancia.estado_actual_id.

      let eceTriajeId: string;

      await ctx.prisma.$transaction(async (tx) => {
        const rawTx = tx as unknown as RawClient;

        // Crear documento_instancia TRIAJE primero (instancia-first, instancia_id NOT NULL).
        const instanciaResult = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<Array<{ id: string; personal_id: string }>>)`
          INSERT INTO ece.documento_instancia (
            tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por
          )
          SELECT td.id, ep.id, ep.paciente_id, fe.id, ps.id
          FROM ece.tipo_documento td
          JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
          JOIN ece.episodio_atencion ep ON ep.id = ${input.episodioId}::uuid
          JOIN ece.personal_salud ps ON ps.his_user_id = ${input.registradoPorId}::uuid AND ps.activo = true
          WHERE td.codigo = 'TRIAJE' AND td.activo = true
          LIMIT 1
          RETURNING id::text, creado_por::text AS personal_id
        `;
        const instanciaId = instanciaResult[0]?.id;
        const personalId  = instanciaResult[0]?.personal_id;
        if (!instanciaId || !personalId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Tipo documento TRIAJE no configurado o profesional no encontrado.",
          });
        }

        eceTriajeId = await insertEceTriaje(rawTx, {
          instanciaId,
          episodioId: input.episodioId,
          motivoConsulta: null, // motivo viene de la evaluación — dejar en null para que enfermero complete
          nivelPrioridad,
          destinoAsignado: input.destinoAsignado ?? null,
          signosVitalesId: input.signosVitalesId ?? null,
          registradoPorId: personalId,
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
        estadoRegistro: "vigente" as const,
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
            const rawTx2 = tx as unknown as RawClient;

            // Instancia-first para syncCompletedTriages.
            const syncInstanciaResult = await (rawTx2.$queryRaw as (
              tpl: TemplateStringsArray,
              ...vals: unknown[]
            ) => Promise<Array<{ id: string; personal_id: string }>>)`
              INSERT INTO ece.documento_instancia (
                tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por
              )
              SELECT td.id, ep.id, ep.paciente_id, fe.id, ps.id
              FROM ece.tipo_documento td
              JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
              JOIN ece.episodio_atencion ep ON ep.id = ${input.defaultEpisodioId!}::uuid
              JOIN ece.personal_salud ps ON ps.his_user_id = ${input.registradoPorId}::uuid AND ps.activo = true
              WHERE td.codigo = 'TRIAJE' AND td.activo = true
              LIMIT 1
              RETURNING id::text, creado_por::text AS personal_id
            `;
            const syncInstanciaId = syncInstanciaResult[0]?.id;
            const syncPersonalId  = syncInstanciaResult[0]?.personal_id;
            if (!syncInstanciaId || !syncPersonalId) {
              throw new Error("Tipo TRIAJE no configurado o profesional no encontrado para sync.");
            }

            eceTriajeId = await insertEceTriaje(rawTx2, {
              instanciaId: syncInstanciaId,
              episodioId: input.defaultEpisodioId!,
              motivoConsulta: row.motivo_consulta,
              nivelPrioridad,
              destinoAsignado: null,
              signosVitalesId: null,
              registradoPorId: syncPersonalId,
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
