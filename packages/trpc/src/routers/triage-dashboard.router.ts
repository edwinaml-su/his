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
import {
  triageDashboardFiltersSchema,
  type TriageQueueItem,
  type TriageQueueResponse,
  type TriageTimerSeverity,
} from "@his/contracts/schemas/triage-dashboard";
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
});
