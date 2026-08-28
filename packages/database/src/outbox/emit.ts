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

  // US.B15.1.4 — audit log wiring (emit).
  // El INSERT de audit corre en la MISMA transacción (atómico con el evento).
  // Si la transacción hace rollback, el audit log NO existe — consistencia
  // append-only entre outbox y auditoría. El trigger SQL
  // `audit.fn_audit_log_chain` calcula prevHash + signatureHash
  // automáticamente (ver packages/database/sql/05_audit_hash_chain.sql).
  //
  // Action: usamos `CREATE` del enum AuditAction existente (NO añadimos
  // valor nuevo — fricción operativa con ALTER TYPE). El sentido semántico
  // "DOMAIN_EVENT_EMITTED" + el eventType se preserva en `justification`.
  //
  // P0-0 (sql/206) — el rol `authenticated` NO tiene GRANT INSERT sobre
  // audit."AuditLog" (y no debe tenerlo: con un rol compartido por todos los
  // usuarios, un INSERT directo permitiría forjar entradas a nombre de otro).
  // Antes de sql/206 eso hacía que TODA ruta demotada que emitiera un evento
  // reventara con `permission denied` y revirtiera la transacción entera —
  // incluido el `DomainEvent` que sí se había insertado, porque ese INSERT
  // sí está permitido. Era el bloqueante de R02 en escrituras.
  //
  // La vía aprobada es `audit.fn_write_manual_audit_entry`: SECURITY DEFINER,
  // deriva el userId de la sesión y exige que el organizationId coincida con
  // el tenant activo, así que ni la identidad ni el tenant son falsificables.
  //
  // Requiere contexto de tenant resoluble por CUALQUIERA de los dos espacios
  // de GUC del proyecto: `app.current_org_id` (withTenantContext) o
  // `app.ece_establecimiento_id` (withEceContext/withWorkflowContext) — ver
  // sql/213_domain_event_dual_context.sql, "la trampa de los dos espacios de
  // GUC" ya documentada en sql/209 para CareTask. Antes de 213 esta sonda
  // solo miraba current_org_id(), así que TODO emisor que corriera dentro de
  // una transacción ECE pura (la mayoría de los ~55 call-sites de
  // emitDomainEvent) caía a la rama de INSERT directo de abajo estando
  // demotado a `authenticated` — que sql/206 dejó sin GRANT INSERT sobre
  // audit."AuditLog" — y reventaba la transacción completa con
  // `insufficient_privilege`, revirtiendo también el DomainEvent recién
  // insertado. `public.current_org_id_or_ece_context()` (SECURITY DEFINER,
  // sql/209) resuelve ambos espacios.
  // Los emisores que corren FUERA de cualquiera de los dos contextos (rol
  // privilegiado/BYPASSRLS, sin demote) no tienen ninguno de los dos GUC, y
  // para ellos el INSERT directo sigue siendo válido porque corren con el rol
  // privilegiado. De ahí la bifurcación: no es defensa contra un error, es
  // que hay dos caminos legítimos y hay que elegir el que corresponde al rol
  // en curso.
  // El resultado se lee con optional chaining a propósito: Prisma real siempre
  // devuelve un array, pero los tests que mockean `tx` no stubean esta sonda —
  // y no deberían tener que hacerlo, porque para ellos el camino relevante es
  // el del rol privilegiado. Sin contexto detectable se usa ese camino, que es
  // además el comportamiento previo a sql/206.
  const ctxRows = (await tx.$queryRaw<Array<{ hasTenantContext: boolean }>>`
    SELECT public.current_org_id_or_ece_context() IS NOT NULL AS "hasTenantContext"
  `) as Array<{ hasTenantContext: boolean }> | undefined;

  if (ctxRows?.[0]?.hasTenantContext === true) {
    await tx.$executeRaw`
      SELECT audit.fn_write_manual_audit_entry(
        ${input.organizationId}::uuid,
        'CREATE'::public."AuditAction",
        'DomainEvent',
        ${created.id},
        ${`DOMAIN_EVENT_EMITTED:${input.eventType}`},
        NULL, NULL, NULL
      )
    `;
  } else {
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.emittedById ?? null,
        action: "CREATE",
        entity: "DomainEvent",
        entityId: created.id,
        justification: `DOMAIN_EVENT_EMITTED:${input.eventType}`,
      },
    });
  }

  return created;
}
