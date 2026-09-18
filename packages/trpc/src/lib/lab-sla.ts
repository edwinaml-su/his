/**
 * Extensión CC-0040 (2026-09-18) — SLA de laboratorio parametrizable.
 *
 * Resuelve los minutos de SLA/aviso por prioridad desde `LabSlaConfig`
 * (sql/251, editable en /catalogs/laboratorio pestaña SLA) con fallback a los
 * defaults que antes vivían hardcodeados en `order-consumer.ts`
 * (SLA_MINUTES_BY_MOCKUP: STAT 60' / Urgente 240' / Rutina 1440').
 *
 * Consumidores: `lis.router` (order.create crea una CareTask por examen;
 * order.supervision calcula el semáforo) y `ece/order-consumer.ts` (órdenes
 * de lab nacidas de indicación hospitalaria) — misma parametrización para
 * ambos caminos, hospitalario y ambulatorio.
 */
import type { PrismaClient, Prisma } from "@prisma/client";

export type LabPriorityKey = "ROUTINE" | "URGENT" | "STAT";

export interface LabSlaValues {
  slaMinutes: number;
  warningMinutes: number;
}

export const DEFAULT_LAB_SLA: Record<LabPriorityKey, LabSlaValues> = {
  STAT: { slaMinutes: 60, warningMinutes: 15 },
  URGENT: { slaMinutes: 240, warningMinutes: 30 },
  ROUTINE: { slaMinutes: 1440, warningMinutes: 60 },
};

type Tx = PrismaClient | Prisma.TransactionClient;

/** Config efectiva por prioridad: fila del tenant si existe, si no el default. */
export async function resolveLabSlaMap(
  tx: Tx,
  organizationId: string,
): Promise<Record<LabPriorityKey, LabSlaValues>> {
  const rows = await tx.labSlaConfig.findMany({
    where: { organizationId },
    select: { priority: true, slaMinutes: true, warningMinutes: true },
  });
  const map = { ...DEFAULT_LAB_SLA };
  for (const r of rows) {
    if (r.priority === "ROUTINE" || r.priority === "URGENT" || r.priority === "STAT") {
      map[r.priority] = { slaMinutes: r.slaMinutes, warningMinutes: r.warningMinutes };
    }
  }
  return map;
}

/** CareTask.priority correspondiente a la prioridad de la orden de lab. */
export const CARE_TASK_PRIORITY_BY_LAB_PRIORITY: Record<
  LabPriorityKey,
  "CRITICAL" | "HIGH" | "NORMAL"
> = {
  STAT: "CRITICAL",
  URGENT: "HIGH",
  ROUTINE: "NORMAL",
};

/**
 * CC-0042 — SLA de terapia respiratoria (`TrSlaConfig`, sql/254).
 * Defaults v1 (RN-TR-21: STAT 15'; sin agenda por frecuencia todavía, el SLA
 * corre desde la firma de la orden): STAT 15' · URGENT 60' · ROUTINE 240'.
 */
export const DEFAULT_TR_SLA: Record<LabPriorityKey, LabSlaValues> = {
  STAT: { slaMinutes: 15, warningMinutes: 5 },
  URGENT: { slaMinutes: 60, warningMinutes: 15 },
  ROUTINE: { slaMinutes: 240, warningMinutes: 30 },
};

export async function resolveTrSlaMap(
  tx: Tx,
  organizationId: string,
): Promise<Record<LabPriorityKey, LabSlaValues>> {
  const rows = await tx.trSlaConfig.findMany({
    where: { organizationId },
    select: { priority: true, slaMinutes: true, warningMinutes: true },
  });
  const map = { ...DEFAULT_TR_SLA };
  for (const r of rows) {
    if (r.priority === "ROUTINE" || r.priority === "URGENT" || r.priority === "STAT") {
      map[r.priority] = { slaMinutes: r.slaMinutes, warningMinutes: r.warningMinutes };
    }
  }
  return map;
}

/**
 * CC-0041 — mismo contrato para imagenología (`ImagingSlaConfig`, sql/253).
 * Los defaults son los mismos de ImagingPriority (schema.prisma: STAT 60' /
 * URGENT 240' / ROUTINE 1440') que ya usa `imaging.order.getOverdueOrders`.
 */
export async function resolveImagingSlaMap(
  tx: Tx,
  organizationId: string,
): Promise<Record<LabPriorityKey, LabSlaValues>> {
  const rows = await tx.imagingSlaConfig.findMany({
    where: { organizationId },
    select: { priority: true, slaMinutes: true, warningMinutes: true },
  });
  const map = { ...DEFAULT_LAB_SLA };
  for (const r of rows) {
    if (r.priority === "ROUTINE" || r.priority === "URGENT" || r.priority === "STAT") {
      map[r.priority] = { slaMinutes: r.slaMinutes, warningMinutes: r.warningMinutes };
    }
  }
  return map;
}
