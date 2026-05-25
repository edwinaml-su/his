/**
 * US-6.5 / US-6.6 — Tablero operativo de triage con cronómetros.
 *
 * Equipo Sierra. Este router se cablea en `_app.ts` cuando @Orq lo agregue —
 * mientras tanto, el cliente lo invoca vía `(trpc as any).triageDashboard.*`
 * (mismo patrón usado por auditIntegrity / userAdmin antes de su wiring).
 *
 * Reglas de negocio:
 *  - `queueWithTimers`: devuelve los TriageEvaluation IN_PROGRESS (excluye
 *    COMPLETED y CANCELLED) del tenant, calcula elapsed/remaining/severity y
 *    los ordena por overdue → priority → startedAt.
 *  - El re-triage automático **NO se ejecuta en el server** (acuerdo Sprint 6):
 *    el detector vive en el cliente y dispara una sugerencia visible en el
 *    card. Cuando el triador acepta, navega a `/triage/[id]/vitals` y la
 *    mutación real la ejecuta `triage.recordVitals` (Kilo) — no la tocamos.
 */
import { z } from "zod";
// NOTE: @his/contracts re-exporta solo lo que está en `schemas/index.ts`.
// Como Sierra tiene prohibido tocar ese barrel (lo cablea Orq), importamos por
// path relativo al package — válido bajo la config TS workspace.
import {
  triageDashboardFiltersSchema,
  type TriageQueueItem,
  type TriageQueueResponse,
  type TriageTimerSeverity,
} from "@his/contracts";
import {
  PROCESS_STEP_LABEL,
  type ProcessStepKey,
  type SexCode,
  type TriageMonitorItem,
  type TriageMonitorResponse,
} from "@his/contracts/schemas/triage-monitor";
import { router, tenantProcedure } from "../trpc";

/** elapsed / max → NORMAL (<70%) / WARNING (70-100%) / CRITICAL (>100%). */
function severityFor(elapsedMinutes: number, maxMinutes: number): TriageTimerSeverity {
  if (maxMinutes <= 0) return "NORMAL";
  const pct = elapsedMinutes / maxMinutes;
  if (pct > 1) return "CRITICAL";
  if (pct > 0.7) return "WARNING";
  return "NORMAL";
}

/** Edad en años, ignora días/meses; null si no hay birthDate. */
function ageInYears(birthDate: Date | null, now: Date): number | null {
  if (!birthDate) return null;
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const m = now.getUTCMonth() - birthDate.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birthDate.getUTCDate())) age -= 1;
  return Math.max(0, age);
}

/** Round a 1 decimal — el segundero lo anima el cliente. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const triageDashboardRouter = router({
  /**
   * Cola activa con cronómetros calculados.
   *
   * Performance notes:
   *  - findMany single query con includes — el volumen esperado es <200 items
   *    por establishment (TDR §9.1 capacity sizing).
   *  - El polling de 10s en el cliente es suficiente para refrescar counts y
   *    detectar nuevos ingresos; el segundero local del TriageTimer no
   *    depende de la red.
   */
  queueWithTimers: tenantProcedure
    .input(triageDashboardFiltersSchema.optional())
    .query(async ({ ctx, input }): Promise<TriageQueueResponse> => {
      const filters = input ?? { onlyActive: true };
      const establishmentId = filters.establishmentId ?? ctx.tenant.establishmentId;

      const search = filters.search && filters.search.length >= 2 ? filters.search : undefined;

      const evaluations = await ctx.prisma.triageEvaluation.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          ...(establishmentId ? { establishmentId } : {}),
          ...(filters.serviceUnitId ? { serviceUnitId: filters.serviceUnitId } : {}),
          status: { notIn: ["COMPLETED", "CANCELLED"] },
          ...(search
            ? {
                patient: {
                  OR: [
                    { mrn: { contains: search, mode: "insensitive" } },
                    { firstName: { contains: search, mode: "insensitive" } },
                    { lastName: { contains: search, mode: "insensitive" } },
                  ],
                },
              }
            : {}),
        },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              mrn: true,
              birthDate: true,
              isUnknown: true,
            },
          },
          serviceUnit: { select: { id: true, name: true } },
          assignedLevel: {
            select: {
              id: true,
              color: true,
              name: true,
              priority: true,
              maxWaitMinutes: true,
              uiColorHex: true,
            },
          },
          // Cuenta encadenada de re-triages siguiendo `reTriageOfId`.
          reTriageOf_back: { select: { id: true } },
        },
      });

      const now = new Date();
      const items: TriageQueueItem[] = evaluations.map((e) => {
        const elapsedMs = now.getTime() - e.startedAt.getTime();
        const elapsedMinutes = round1(elapsedMs / 60_000);
        const remainingMinutes = round1(e.assignedLevel.maxWaitMinutes - elapsedMinutes);
        const isOverdue = elapsedMinutes > e.assignedLevel.maxWaitMinutes;
        const severity = severityFor(elapsedMinutes, e.assignedLevel.maxWaitMinutes);
        return {
          id: e.id,
          patient: {
            id: e.patient.id,
            firstName: e.patient.firstName,
            lastName: e.patient.lastName,
            mrn: e.patient.mrn,
            ageYears: ageInYears(e.patient.birthDate, now),
            isUnknown: e.patient.isUnknown,
          },
          encounterId: e.encounterId,
          serviceUnit: e.serviceUnit
            ? { id: e.serviceUnit.id, name: e.serviceUnit.name }
            : null,
          assignedLevel: {
            id: e.assignedLevel.id,
            color: e.assignedLevel.color,
            name: e.assignedLevel.name,
            priority: e.assignedLevel.priority,
            maxWaitMinutes: e.assignedLevel.maxWaitMinutes,
            uiColorHex: e.assignedLevel.uiColorHex,
          },
          status: e.status,
          startedAt: e.startedAt,
          reTriageCount: e.reTriageOf_back.length,
          elapsedMinutes,
          remainingMinutes,
          isOverdue,
          severity,
        };
      });

      // Orden: overdue first (más overdue primero) → priority asc (RED=1) →
      // startedAt asc (FIFO dentro del mismo nivel).
      items.sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        if (a.isOverdue && b.isOverdue) {
          // mayor "exceso" primero
          const exA = a.elapsedMinutes - a.assignedLevel.maxWaitMinutes;
          const exB = b.elapsedMinutes - b.assignedLevel.maxWaitMinutes;
          if (exA !== exB) return exB - exA;
        }
        if (a.assignedLevel.priority !== b.assignedLevel.priority) {
          return a.assignedLevel.priority - b.assignedLevel.priority;
        }
        return a.startedAt.getTime() - b.startedAt.getTime();
      });

      // Counts por nivel — incluye niveles activos sin items en cero para el
      // header con 5 cards.
      const levels = await ctx.prisma.triageLevel.findMany({
        where: { organizationId: ctx.tenant.organizationId, active: true },
        orderBy: { priority: "asc" },
        select: { color: true, name: true, uiColorHex: true },
      });
      const counts = levels.map((lvl) => {
        const matching = items.filter((i) => i.assignedLevel.color === lvl.color);
        return {
          color: lvl.color,
          name: lvl.name,
          uiColorHex: lvl.uiColorHex,
          count: matching.length,
          overdueCount: matching.filter((i) => i.isOverdue).length,
        };
      });

      return {
        serverNow: now,
        counts,
        totalActive: items.length,
        totalOverdue: items.filter((i) => i.isOverdue).length,
        items,
      };
    }),

  /**
   * Sugerencia: marcar una evaluación como "atendida" (status COMPLETED) sin
   * pasar por discriminadores — para uso del triador cuando el paciente ya
   * fue derivado a otro flujo. NO confundir con la finalización clínica
   * (esa la hace `triage.createEvaluation` de Mike).
   *
   * MVP: solo emite el cambio de status; la transición real con auditoría se
   * añadirá en US-6.7 cuando se integre con `encounter`.
   */
  closeEvaluation: tenantProcedure
    .input(z.object({ triageEvaluationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.triageEvaluation.updateMany({
        where: {
          id: input.triageEvaluationId,
          organizationId: ctx.tenant.organizationId,
          status: "IN_PROGRESS",
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          updatedBy: ctx.user.id,
        },
      });
      return { closed: updated.count };
    }),

  /**
   * Wallboard kanban — pantalla operativa para monitor de pared.
   *
   * Diferencias con queueWithTimers:
   *  - Devuelve evaluaciones IN_PROGRESS *y* COMPLETED del día con encounter
   *    aún abierto (para seguir al paciente post-triage).
   *  - Resuelve `sexCode` desde patient.biologicalSex.code (M/F/I/U).
   *  - Deriva `processStep` desde:
   *      Encounter.dischargedAt (si seteado → DISCHARGE_READY si <2h)
   *      InpatientAdmission activa (ADMITTED)
   *      LabOrder activa (PENDING_LAB)
   *      ImagingOrder activa (PENDING_IMAGING)
   *      EhrNote reciente (IN_CONSULTATION)
   *      TriageEvaluation IN_PROGRESS (TRIAGE)
   *      COMPLETED sin actividad clínica (WAITING_DOCTOR)
   *  - Devuelve items pre-agrupados por color (5 lanes), sin separar.
   */
  monitorWallboard: tenantProcedure
    .input(
      z
        .object({
          establishmentId: z.string().uuid().optional(),
          serviceUnitId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<TriageMonitorResponse> => {
      const establishmentId = input?.establishmentId ?? ctx.tenant.establishmentId;
      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);

      // 1. Triage evaluations: IN_PROGRESS o COMPLETED del día.
      const evaluations = await ctx.prisma.triageEvaluation.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          ...(establishmentId ? { establishmentId } : {}),
          ...(input?.serviceUnitId ? { serviceUnitId: input.serviceUnitId } : {}),
          status: { in: ["IN_PROGRESS", "COMPLETED"] },
          startedAt: { gte: dayStart },
        },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              mrn: true,
              birthDate: true,
              isUnknown: true,
              biologicalSex: { select: { code: true } },
            },
          },
          assignedLevel: {
            select: {
              color: true,
              name: true,
              priority: true,
              maxWaitMinutes: true,
              uiColorHex: true,
            },
          },
        },
      });

      const encounterIds = evaluations
        .map((e) => e.encounterId)
        .filter((id): id is string => !!id);

      // 2. Encounters relacionados — para detectar dischargedAt y admissionType.
      const encounters = encounterIds.length
        ? await ctx.prisma.encounter.findMany({
            where: { id: { in: encounterIds } },
            select: {
              id: true,
              dischargedAt: true,
              admissionType: true,
            },
          })
        : [];
      const encounterById = new Map(encounters.map((e) => [e.id, e]));

      // 3. InpatientAdmission activa por encounter.
      const inpatientAdmissions = encounterIds.length
        ? await ctx.prisma.$queryRawUnsafe<
            Array<{ encounterId: string }>
          >(
            `SELECT "encounterId" FROM "InpatientAdmission"
             WHERE "encounterId" = ANY($1::uuid[])
               AND ("dischargedAt" IS NULL OR "dischargedAt" > now())`,
            encounterIds,
          )
        : [];
      const admittedEncSet = new Set(inpatientAdmissions.map((a) => a.encounterId));

      // 4. LabOrders pendientes por encounter (status ORDERED|IN_PROGRESS).
      const labOrders = encounterIds.length
        ? await ctx.prisma.labOrder.findMany({
            where: {
              encounterId: { in: encounterIds },
              status: { in: ["ORDERED", "COLLECTED", "IN_PROCESS"] },
            },
            select: { encounterId: true },
          })
        : [];
      const pendingLabSet = new Set(labOrders.map((l) => l.encounterId));

      // 5. ImagingOrders pendientes por encounter.
      const imgOrders = encounterIds.length
        ? await ctx.prisma.imagingOrder.findMany({
            where: {
              encounterId: { in: encounterIds },
              status: { in: ["ORDERED", "SCHEDULED", "IN_PROGRESS"] },
            },
            select: { encounterId: true },
          })
        : [];
      const pendingImgSet = new Set(imgOrders.map((i) => i.encounterId));

      // 6. EhrNote reciente (última hora) por encounter → señal "en consulta".
      const recentNotes = encounterIds.length
        ? await ctx.prisma.$queryRawUnsafe<
            Array<{ encounterId: string }>
          >(
            `SELECT DISTINCT "encounterId" FROM "EhrNote"
             WHERE "encounterId" = ANY($1::uuid[])
               AND "createdAt" > now() - interval '60 minutes'`,
            encounterIds,
          )
        : [];
      const inConsultSet = new Set(recentNotes.map((n) => n.encounterId));

      function deriveProcessStep(
        evalStatus: string,
        encounterId: string | null,
      ): ProcessStepKey {
        if (evalStatus === "IN_PROGRESS") return "TRIAGE";
        if (!encounterId) return "WAITING_DOCTOR";

        if (admittedEncSet.has(encounterId)) return "ADMITTED";

        const enc = encounterById.get(encounterId);
        if (enc?.dischargedAt) {
          const diffMin = (now.getTime() - enc.dischargedAt.getTime()) / 60_000;
          if (diffMin < 120 && diffMin > -120) return "DISCHARGE_READY";
        }

        if (pendingLabSet.has(encounterId)) return "PENDING_LAB";
        if (pendingImgSet.has(encounterId)) return "PENDING_IMAGING";
        if (inConsultSet.has(encounterId)) return "IN_CONSULTATION";

        // Emergency / scheduled sin admission activa todavía → posible
        // admisión pendiente (señal débil, último fallback útil)
        if (enc?.admissionType === "EMERGENCY") return "PENDING_ADMISSION";

        return "WAITING_DOCTOR";
      }

      // 7. Niveles activos del tenant (para asegurar 5 columnas aunque vacías).
      const levels = await ctx.prisma.triageLevel.findMany({
        where: { organizationId: ctx.tenant.organizationId, active: true },
        orderBy: { priority: "asc" },
        select: {
          color: true,
          name: true,
          uiColorHex: true,
          maxWaitMinutes: true,
          priority: true,
        },
      });

      // 8. Construir items.
      const items: TriageMonitorItem[] = evaluations.map((e) => {
        const elapsedMs = now.getTime() - e.startedAt.getTime();
        const elapsedMinutes = round1(elapsedMs / 60_000);
        const remainingMinutes = round1(e.assignedLevel.maxWaitMinutes - elapsedMinutes);
        const isOverdue = elapsedMinutes > e.assignedLevel.maxWaitMinutes;
        const severity: TriageTimerSeverity = severityFor(
          elapsedMinutes,
          e.assignedLevel.maxWaitMinutes,
        );
        const processStep = deriveProcessStep(e.status, e.encounterId);
        const rawSex = e.patient.biologicalSex?.code ?? null;
        const sexCode: SexCode | null =
          rawSex === "M" || rawSex === "F" || rawSex === "I" || rawSex === "U"
            ? (rawSex as SexCode)
            : null;
        return {
          id: e.id,
          patient: {
            id: e.patient.id,
            firstName: e.patient.firstName,
            lastName: e.patient.lastName,
            mrn: e.patient.mrn,
            ageYears: ageInYears(e.patient.birthDate, now),
            sexCode,
            isUnknown: e.patient.isUnknown,
          },
          encounterId: e.encounterId,
          assignedLevel: {
            color: e.assignedLevel.color,
            name: e.assignedLevel.name,
            priority: e.assignedLevel.priority,
            maxWaitMinutes: e.assignedLevel.maxWaitMinutes,
            uiColorHex: e.assignedLevel.uiColorHex,
          },
          startedAt: e.startedAt,
          elapsedMinutes,
          remainingMinutes,
          isOverdue,
          severity,
          processStep,
          processStepLabel: PROCESS_STEP_LABEL[processStep],
        };
      });

      // 9. Agrupar en lanes por color, ordenados internamente por overdue→
      //    priority→startedAt asc (FIFO).
      function sortLane(a: TriageMonitorItem, b: TriageMonitorItem) {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        return a.startedAt.getTime() - b.startedAt.getTime();
      }

      const monitorLevels = levels.map((lvl) => {
        const laneItems = items
          .filter((i) => i.assignedLevel.color === lvl.color)
          .sort(sortLane);
        return {
          color: lvl.color,
          name: lvl.name,
          uiColorHex: lvl.uiColorHex,
          maxWaitMinutes: lvl.maxWaitMinutes,
          count: laneItems.length,
          overdueCount: laneItems.filter((i) => i.isOverdue).length,
          items: laneItems,
        };
      });

      return {
        serverNow: now,
        totalActive: items.length,
        totalOverdue: items.filter((i) => i.isOverdue).length,
        levels: monitorLevels,
      };
    }),
});
