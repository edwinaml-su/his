import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  domainEventPayloadSchema,
  type EventType,
} from "@his/contracts/events";

/**
 * Beta.15 — Helper de emisión de eventos de dominio (outbox transaccional).
 *
 * USO en routers tRPC / server actions:
 *
 * ```ts
 * await prisma.$transaction(async (tx) => {
 *   const vitals = await tx.inpatientVitals.create({ data: { ... } });
 *   const alerts = detectVitalAlerts(vitals);
 *   if (alerts.some((a) => a.severity === "CRITICAL")) {
 *     await emitDomainEvent(tx, {
 *       organizationId: ctx.orgId,
 *       eventType: "vital.critical",
 *       aggregateType: "InpatientVitals",
 *       aggregateId: vitals.id,
 *       emittedById: ctx.userId,
 *       payload: {
 *         source: "InpatientVitals",
 *         admissionId: vitals.admissionId,
 *         patientId: vitals.patientId,
 *         sourceRowId: vitals.id,
 *         alerts,
 *       },
 *     });
 *   }
 * });
 * ```
 *
 * Garantías:
 *   - El INSERT ocurre dentro de la transacción del caller (tx). Si la
 *     transacción hace rollback, el evento NO existe — outbox atómico.
 *   - El payload se valida con Zod ANTES del INSERT (discriminated union por
 *     eventType). Si payload no matchea shape declarado, lanza ZodError —
 *     el router debe propagar (NO swallow).
 *   - Computa `payloadHash` SHA-256 hex para dedup defensivo futuro.
 *
 * NO garantiza:
 *   - Que la notificación se entregue. Eso lo hace el poller (`pg_cron`) +
 *     dispatcher (Edge Function) — actualmente comentado, ver @SRE review.
 *
 * Ver:
 *   - Backlog US.B15.1.1, US.B15.1.2 (`docs/backlog/beta15_alerts_notifications.md`).
 *   - Blueprint §3 (`docs/blueprints/beta15_notifications.md`).
 *   - DBA review §S2.1 (`docs/blueprints/beta15_notifications_dba_review.md`).
 */

export interface EmitDomainEventInput {
  organizationId: string;
  eventType: EventType;
  aggregateType: string;
  aggregateId: string;
  /** Forma del payload depende del eventType — validado con discriminated union. */
  payload: unknown;
  /** UUID del usuario que disparó la mutación. Opcional para eventos sistémicos. */
  emittedById?: string | null;
}

/**
 * Tipo del primer parámetro: cliente transaccional Prisma o el cliente raíz.
 * Aceptamos ambos porque algunos contextos legítimos (workers internos) emiten
 * SIN transacción. El helper NO crea la transacción — el caller decide.
 */
export type EmitDomainEventTx =
  | PrismaClient
  | Prisma.TransactionClient;

/**
 * Inserta una fila en `DomainEvent` validando el payload contra el schema Zod
 * registrado para el `eventType`. Devuelve el id del evento creado.
 */
export async function emitDomainEvent(
  tx: EmitDomainEventTx,
  input: EmitDomainEventInput
): Promise<{ id: string }> {
  if (!tx) {
    throw new Error(
      "emitDomainEvent: tx argument is required (PrismaClient or TransactionClient)."
    );
  }

  // Validación canónica: el shape del payload debe matchear el del eventType.
  // ZodError propaga al caller si falla — NO swallow.
  domainEventPayloadSchema.parse({
    eventType: input.eventType,
    payload: input.payload,
  });

  const payloadJson = JSON.stringify(input.payload);
  const payloadHash = createHash("sha256").update(payloadJson).digest("hex");

  const created = await tx.domainEvent.create({
    data: {
      organizationId: input.organizationId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload as Prisma.InputJsonValue,
      payloadHash,
      emittedById: input.emittedById ?? null,
    },
    select: { id: true },
  });

  return created;
}
