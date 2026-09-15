/**
 * quirofano-conflicto.ts — C5 auditoría P0-5 (docs/audit/2026-09-15_cobertura/
 * 01-admision-emergencia-hosp-quirofano.md).
 *
 * Detección de doble-booking de quirófano — ÚNICO algoritmo de overlap
 * usado por las dos vías del proceso quirúrgico:
 *   - legacy `surgery.router.ts` (case.create / case.postpone) sobre
 *     `public.SurgeryCase` / `public.OperatingRoom`.
 *   - NTEC `ece/bridge-cirugia.router.ts` (programarCirugia) sobre
 *     `ece.reserva_sala_qx` / `ece.sala_qx`.
 *
 * Antes de este archivo cada vía tenía su propia función de detección
 * (`detectOrConflict` / `detectarConflictoSala`) — misma lógica de overlap
 * de rango de fechas, duplicada dos veces.
 *
 * LIMITACIÓN CONOCIDA (documentada a propósito, no resuelta aquí):
 * `public.OperatingRoom` y `ece.sala_qx` son catálogos SIN vínculo FK (ver
 * ADR 0021 — "Fuente de verdad del proceso quirúrgico", decisión pendiente
 * de Edwin) y las dos vías corren bajo contextos RLS con espacios de GUC
 * distintos (`withTenantContext` setea `app.current_org_id`;
 * `withWorkflowContext` — packages/trpc/src/workflow/context.ts — setea
 * `app.ece_establecimiento_id` vía `ece.set_ece_context`, SIN tocar
 * `app.current_org_id`). Consultar `SurgeryCase` bajo el contexto ECE (o
 * `EceReservaSalaQx` bajo el contexto tenant) devolvería 0 filas por RLS,
 * no por ausencia real de conflicto — sería un cruce ilusorio, peor que no
 * cruzar. Por eso esta función NO intenta resolver "la misma sala física"
 * entre ambos catálogos: cada caller la invoca con SU PROPIO identificador
 * (`operatingRoomId` o `salaQxId`) dentro de SU PROPIO contexto RLS, y solo
 * verifica overlap dentro de esa misma tabla. Cerrar la brecha de verdad
 * única de disponibilidad de sala requiere ejecutar ADR 0021 (Opción B o C)
 * — fuera de alcance de CC-0034 (fix mínimo, sin tocar el bridge de
 * identidad de catálogos ni la plumbing de RLS compartida).
 */
import type { PrismaClient } from "@prisma/client";

/** Estados no terminales de `SurgeryCase` que ocupan un slot de quirófano. */
const OR_ACTIVE_STATUSES = ["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "POST_OP"] as const;

/** Estados no terminales de `ece.reserva_sala_qx` que ocupan la sala. */
const RESERVA_ACTIVE_STATES = ["programado", "confirmado", "en_curso"] as const;

export interface ConflictoQuirofanoParams {
  scheduledStart: Date;
  scheduledEnd: Date;
  /** vía legacy (`surgery.router.ts`) — `public.OperatingRoom.id`. */
  operatingRoomId?: string | null;
  excludeSurgeryCaseId?: string;
  /** vía NTEC (`bridge-cirugia.router.ts`) — `ece.sala_qx.id`. */
  salaQxId?: string | null;
  excludeReservaSalaQxId?: string;
}

type ConflictoQuirofanoTx = Pick<PrismaClient, "surgeryCase" | "eceReservaSalaQx">;

/**
 * true si hay una reserva activa que se superpone con
 * [scheduledStart, scheduledEnd) en la sala identificada. Overlap:
 * existing.start < newEnd AND existing.end > newStart (mismo criterio en
 * ambas tablas).
 */
export async function hayConflictoQuirofano(
  tx: ConflictoQuirofanoTx,
  params: ConflictoQuirofanoParams,
): Promise<boolean> {
  if (params.operatingRoomId) {
    const conflict = await tx.surgeryCase.findFirst({
      where: {
        operatingRoomId: params.operatingRoomId,
        deletedAt: null,
        status: { in: [...OR_ACTIVE_STATUSES] },
        ...(params.excludeSurgeryCaseId && { id: { not: params.excludeSurgeryCaseId } }),
        scheduledStart: { lt: params.scheduledEnd },
        scheduledEnd: { gt: params.scheduledStart },
      },
      select: { id: true },
    });
    if (conflict) return true;
  }

  if (params.salaQxId) {
    const conflict = await tx.eceReservaSalaQx.findFirst({
      where: {
        salaQxId: params.salaQxId,
        estado: { in: [...RESERVA_ACTIVE_STATES] },
        ...(params.excludeReservaSalaQxId && { id: { not: params.excludeReservaSalaQxId } }),
        fechaInicio: { lt: params.scheduledEnd },
        fechaFin: { gt: params.scheduledStart },
      },
      select: { id: true },
    });
    if (conflict) return true;
  }

  return false;
}
