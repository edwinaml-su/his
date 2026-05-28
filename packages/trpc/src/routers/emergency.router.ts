/**
 * §12 Emergency — router (Beta.4 hardening capa 1).
 *
 * Cobertura Beta.4:
 *   - visit CRUD + observation start/end + notes + disposition.
 *   - State machine enforcement (canTransitionEmergencyDisposition).
 *   - LWBS check (dry-run + commit) via cron/admin.
 *   - Vitales con detección automática de re-triage (shouldTriggerRetriage).
 *
 * Reglas que NO cubre Beta.4 (out of scope):
 *   - Cron job automático (vive en infraestructura externa).
 *   - Escalación clínica y handoff a inpatient (Wave 2 hardening).
 *   - Tracking dose dispatcher 4-eyes (no aplica a Emergency, sí a eMAR).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  canTransitionEmergencyDisposition,
  computeObservationDuration,
  detectLwbsCandidate,
  emergencyNoteCreateInput,
  emergencyVisitCreateInput,
  emergencyVisitDispositionInput,
  emergencyVisitEndObservationInput,
  emergencyVisitListInput,
  emergencyVisitStartObservationInput,
  emergencyVitalRecordInput,
  isTerminalEmergencyDisposition,
  lwbsCheckInput,
  shouldTriggerRetriage,
  type EmergencyDispositionType,
  type VitalSnapshot,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";
import {
  isOutOfServiceUnitScope,
  serviceUnitWhereFragment,
} from "../lib/service-unit-scope";

export const emergencyRouter = router({
  visit: router({
    list: tenantProcedure
      .input(emergencyVisitListInput)
      .query(async ({ ctx, input }) => {
        // Nivel B — EmergencyVisit no tiene serviceUnitId propio; scope via
        // el Encounter padre (siempre EMERGENCY, encounter.serviceUnitId = ER
        // o similar). Incluye nulls (encounters recién creados sin servicio).
        const encScope = serviceUnitWhereFragment(
          ctx.tenant,
          "serviceUnitId",
          { includeNullable: true },
        );
        const encounterFilter =
          Object.keys(encScope).length > 0 ? { encounter: encScope } : {};

        return ctx.prisma.emergencyVisit.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
            ...encounterFilter,
            ...(input.disposition && { disposition: input.disposition }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.treatingId && { treatingId: input.treatingId }),
            ...(input.establishmentId && {
              establishmentId: input.establishmentId,
            }),
            ...((input.fromDate || input.toDate) && {
              arrivedAt: {
                ...(input.fromDate && { gte: input.fromDate }),
                ...(input.toDate && { lte: input.toDate }),
              },
            }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
          },
          orderBy: { arrivedAt: "desc" },
          take: input.limit,
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.emergencyVisit.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    /** Beta.4: derivado computado de observación, no persistido. */
    getObservationStatus: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const v = await ctx.prisma.emergencyVisit.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: {
            observationStartedAt: true,
            observationEndedAt: true,
          },
        });
        if (!v) throw new TRPCError({ code: "NOT_FOUND" });
        const dur = computeObservationDuration({
          observationStartedAt: v.observationStartedAt,
          observationEndedAt: v.observationEndedAt,
          now: new Date(),
        });
        return {
          minutes: dur.minutes,
          isOpen: dur.isOpen,
          startedAt: v.observationStartedAt,
          endedAt: v.observationEndedAt,
        };
      }),

    create: tenantProcedure
      .input(emergencyVisitCreateInput)
      .mutation(async ({ ctx, input }) => {
        const enc = await ctx.prisma.encounter.findFirst({
          where: {
            id: input.encounterId,
            organizationId: ctx.tenant.organizationId,
          },
          select: { id: true, patientId: true, serviceUnitId: true },
        });
        if (!enc) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Encuentro no existe en la organización.",
          });
        }
        if (enc.patientId !== input.patientId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "patientId no coincide con encounter.",
          });
        }
        // Nivel B — el encuentro debe pertenecer a un servicio del usuario.
        // enc.serviceUnitId puede ser null (encounter recién admitido sin
        // clasificar) → el helper lo permite (no podemos validar).
        if (isOutOfServiceUnitScope(ctx.tenant, enc.serviceUnitId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "El encuentro pertenece a un servicio fuera de tus asignaciones.",
          });
        }

        // TDR §12.4 — triage Manchester obligatorio antes de admisión a Urgencias.
        // Ventana de 4 horas: triage completado recientemente sigue siendo válido para
        // el encuentro actual (misma visita al servicio de urgencias).
        const TRIAGE_WINDOW_MS = 4 * 60 * 60 * 1000;
        const windowStart = new Date(Date.now() - TRIAGE_WINDOW_MS);
        const completedTriage = await ctx.prisma.triageEvaluation.findFirst({
          where: {
            patientId: input.patientId,
            organizationId: ctx.tenant.organizationId,
            status: "COMPLETED",
            completedAt: { gte: windowStart },
          },
          select: { id: true },
          orderBy: { completedAt: "desc" },
        });
        if (!completedTriage) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Triage Manchester previo es obligatorio. Realice triage antes de admitir a Emergencias.",
          });
        }

        return ctx.prisma.emergencyVisit.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            establishmentId: input.establishmentId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            chiefComplaint: input.chiefComplaint,
            arrivalMode: input.arrivalMode,
            treatingId: input.treatingId ?? null,
            triageEvaluationId: completedTriage.id,
            createdBy: ctx.user.id,
          },
        });
      }),

    /**
     * Beta.4: enforcement de state machine. Lee la disposition actual,
     * valida transición permitida, y persiste solo si pasa.
     */
    setDisposition: tenantProcedure
      .input(emergencyVisitDispositionInput)
      .mutation(async ({ ctx, input }) => {
        const visit = await ctx.prisma.emergencyVisit.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, disposition: true },
        });
        if (!visit) throw new TRPCError({ code: "NOT_FOUND" });

        const from = visit.disposition as EmergencyDispositionType;
        const to = input.disposition;

        if (from === to) {
          return { ok: true as const, transitioned: false };
        }
        if (!canTransitionEmergencyDisposition(from, to)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Transición inválida: ${from} -> ${to}.`,
          });
        }

        await ctx.prisma.emergencyVisit.update({
          where: { id: input.id },
          data: {
            disposition: to,
            dispositionAt: new Date(),
            ...(input.notes && { notes: input.notes }),
            updatedBy: ctx.user.id,
          },
        });
        return { ok: true as const, transitioned: true };
      }),

    startObservation: tenantProcedure
      .input(emergencyVisitStartObservationInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.emergencyVisit.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            observationStartedAt: null,
            deletedAt: null,
          },
          data: {
            observationStartedAt: new Date(),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Visita no existe u observación ya iniciada.",
          });
        }
        return { ok: true as const };
      }),

    endObservation: tenantProcedure
      .input(emergencyVisitEndObservationInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.emergencyVisit.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            observationStartedAt: { not: null },
            observationEndedAt: null,
            deletedAt: null,
          },
          data: {
            observationEndedAt: new Date(),
            updatedBy: ctx.user.id,
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Visita no existe, sin observación abierta.",
          });
        }
        return { ok: true as const };
      }),

    /**
     * Beta.4: chequeo LWBS para visitas PENDING sin treating asignado.
     * Default dryRun=true; en commit, intenta transición PENDING->LWBS
     * vía state machine (que la admite).
     */
    lwbsCheck: tenantProcedure
      .input(lwbsCheckInput)
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const candidates = await ctx.prisma.emergencyVisit.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            disposition: "PENDING",
            treatingId: null,
            deletedAt: null,
          },
          select: {
            id: true,
            arrivedAt: true,
            disposition: true,
            treatingId: true,
          },
          take: input.limit,
        });

        const results = candidates.map((v) => {
          const det = detectLwbsCandidate({
            visit: {
              disposition: v.disposition as EmergencyDispositionType,
              arrivedAt: v.arrivedAt,
              treatingId: v.treatingId,
            },
            now,
            timeoutMinutes: input.timeoutMinutes,
          });
          return {
            id: v.id,
            arrivedAt: v.arrivedAt,
            elapsedMinutes: det.elapsedMinutes,
            timeoutMinutes: det.timeoutMinutes,
            isCandidate: det.isCandidate,
            reason: det.reason,
          };
        });

        const flagged = results.filter((r) => r.isCandidate);

        if (input.dryRun || flagged.length === 0) {
          return {
            dryRun: input.dryRun,
            evaluated: results.length,
            flagged: flagged.length,
            details: flagged,
          };
        }

        // Commit: bulk update solo las que pasaron la detección.
        const ids = flagged.map((r) => r.id);
        await ctx.prisma.emergencyVisit.updateMany({
          where: {
            id: { in: ids },
            organizationId: ctx.tenant.organizationId,
            disposition: "PENDING", // re-check para race condition
          },
          data: {
            disposition: "LWBS",
            dispositionAt: now,
            updatedBy: ctx.user.id,
          },
        });

        return {
          dryRun: false,
          evaluated: results.length,
          flagged: flagged.length,
          details: flagged,
        };
      }),

    /**
     * Beta.4: registro de vitales con detección de deterioro.
     * NO crea persistencia clínica formal (eso es responsabilidad del
     * router triage/inpatient). Solo evalúa y retorna sugerencia.
     */
    recordVitalSnapshot: tenantProcedure
      .input(emergencyVitalRecordInput)
      .mutation(async ({ ctx, input }) => {
        const visit = await ctx.prisma.emergencyVisit.findFirst({
          where: {
            id: input.visitId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, encounterId: true, disposition: true },
        });
        if (!visit) throw new TRPCError({ code: "NOT_FOUND" });
        if (isTerminalEmergencyDisposition(visit.disposition as EmergencyDispositionType)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Visita ya finalizada; no admite vitales.",
          });
        }

        // Recupera vitales recientes del encounter (4NF — key-value) y
        // pivotea a snapshot wide para evaluación de deterioro.
        const lastVitals = await ctx.prisma.triageVitalSign.findMany({
          where: {
            evaluation: {
              encounterId: visit.encounterId,
              organizationId: ctx.tenant.organizationId,
            },
          },
          orderBy: { measuredAt: "desc" },
          take: 50, // ventana suficiente para cubrir últimos códigos
          select: {
            vitalCode: true,
            valueNumeric: true,
            measuredAt: true,
          },
        });

        const previous = lastVitals.length > 0
          ? pivotVitalsToSnapshot(lastVitals)
          : null;

        const current: VitalSnapshot = {
          heartRate: input.heartRate,
          respiratoryRate: input.respiratoryRate,
          spo2: input.spo2,
          systolicBp: input.systolicBp,
          temperatureC: input.temperatureC,
          painScale: input.painScale,
        };

        const evaluation = shouldTriggerRetriage({ previous, current });

        // Registra como EmergencyNote categoría REASSESSMENT con el resumen.
        const summary = formatVitalSummary(current);
        await ctx.prisma.emergencyNote.create({
          data: {
            visitId: visit.id,
            recordedById: ctx.user.id,
            category: "REASSESSMENT",
            body: input.notes
              ? `${summary}\nNota: ${input.notes}`
              : summary,
          },
        });

        return {
          retriageSuggested: evaluation.shouldRetriage,
          reasons: evaluation.reasons,
          recorded: true,
        };
      }),
  }),

  note: router({
    create: tenantProcedure
      .input(emergencyNoteCreateInput)
      .mutation(async ({ ctx, input }) => {
        const visit = await ctx.prisma.emergencyVisit.findFirst({
          where: {
            id: input.visitId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, disposition: true },
        });
        if (!visit) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Visita no existe en la organización.",
          });
        }
        // Beta.4: bloqueo de notas sobre visitas terminadas para preservar
        // integridad clínica del cierre.
        if (isTerminalEmergencyDisposition(visit.disposition as EmergencyDispositionType)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Visita ya finalizada; no admite notas adicionales.",
          });
        }
        return ctx.prisma.emergencyNote.create({
          data: {
            visitId: input.visitId,
            recordedById: ctx.user.id,
            category: input.category,
            body: input.body,
          },
        });
      }),

    listByVisit: tenantProcedure
      .input(
        z.object({
          visitId: z.string().uuid(),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .query(async ({ ctx, input }) => {
        return ctx.prisma.emergencyNote.findMany({
          where: {
            visitId: input.visitId,
            visit: { organizationId: ctx.tenant.organizationId },
          },
          orderBy: { recordedAt: "desc" },
          take: input.limit,
        });
      }),
  }),
});

/** Helper privado — formato compacto de vitales para nota REASSESSMENT. */
function formatVitalSummary(v: VitalSnapshot): string {
  const parts: string[] = [];
  if (v.heartRate != null) parts.push(`HR=${v.heartRate}`);
  if (v.respiratoryRate != null) parts.push(`RR=${v.respiratoryRate}`);
  if (v.spo2 != null) parts.push(`SpO2=${v.spo2}%`);
  if (v.systolicBp != null) parts.push(`SBP=${v.systolicBp}`);
  if (v.temperatureC != null) parts.push(`T=${v.temperatureC}°C`);
  if (v.painScale != null) parts.push(`pain=${v.painScale}`);
  return `[Vitales] ${parts.join(", ")}`;
}

/**
 * Helper privado — pivotea vitales 4NF (key-value) a snapshot wide tomando
 * el valor más reciente por código. `vitalCode` esperado mapea:
 *   HR -> heartRate, RR -> respiratoryRate, SpO2 -> spo2, SBP -> systolicBp,
 *   TEMP -> temperatureC, PAIN -> painScale.
 * Códigos desconocidos se ignoran silenciosamente.
 */
function pivotVitalsToSnapshot(
  rows: ReadonlyArray<{
    vitalCode: string;
    valueNumeric: { toNumber?: () => number } | number | null | undefined;
    measuredAt: Date;
  }>,
): VitalSnapshot {
  // rows vienen ordenadas desc por measuredAt; primer match gana.
  const snap: VitalSnapshot = {};
  const seen = new Set<string>();
  for (const r of rows) {
    const code = r.vitalCode.toUpperCase();
    if (seen.has(code)) continue;
    const num = decimalToNumber(r.valueNumeric);
    if (num === null) continue;
    switch (code) {
      case "HR":
        snap.heartRate = Math.round(num);
        seen.add(code);
        break;
      case "RR":
        snap.respiratoryRate = Math.round(num);
        seen.add(code);
        break;
      case "SPO2":
      case "SAT":
        snap.spo2 = Math.round(num);
        seen.add(code);
        break;
      case "SBP":
      case "BP_SYS":
        snap.systolicBp = Math.round(num);
        seen.add(code);
        break;
      case "TEMP":
      case "T":
        snap.temperatureC = num;
        seen.add(code);
        break;
      case "PAIN":
        snap.painScale = Math.round(num);
        seen.add(code);
        break;
    }
  }
  return snap;
}

function decimalToNumber(
  v: { toNumber?: () => number } | number | null | undefined,
): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && typeof v.toNumber === "function") {
    return v.toNumber();
  }
  // Si llega como string-like via Prisma.Decimal sin toNumber binding (raro)
  const n = Number(v as unknown as string);
  return Number.isFinite(n) ? n : null;
}
