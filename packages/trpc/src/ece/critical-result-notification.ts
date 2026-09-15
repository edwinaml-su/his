/**
 * CC-0035 (auditoría C6, 2026-09-15, P0-2/P0-11) — helper compartido que
 * inserta `ece.critical_result_notification` + emite `critical_result.emitted`.
 *
 * Extraído de `routers/ece/critical-result.router.ts` (`emit`) para que
 * también lo use `routers/lis.router.ts` (`result.enter`) — el propio
 * critical-result.router.ts documentaba como TODO pendiente el wiring
 * LIS→emit ("el wiring LIS→emit se completa en sprint posterior"); este
 * cambio lo cierra sin duplicar el INSERT + emitDomainEvent en los dos
 * routers.
 *
 * El caller es responsable de establecer el contexto RLS/tenant de `tx`
 * (withTenantContext / applyTenantContext) ANTES de invocar — este helper
 * no lo hace, para no imponer un `demoteRole` particular a callers con
 * necesidades distintas (ver la nota sobre `demoteRole:false` en
 * critical-result.router.ts).
 */
import { TRPCError } from "@trpc/server";
import { emitDomainEvent, type EmitDomainEventTx } from "@his/database";

export type CriticalResultSeveridad = "alta" | "muy_alta" | "crítica";

export interface CreateCriticalResultNotificationInput {
  organizationId: string;
  labResultId: string;
  pacienteId: string;
  /** `ece.personal_salud.id` — FK real de la tabla (NO el userId HIS). */
  medicoTratanteId: string;
  /**
   * `public."User".id` del médico tratante, cuando el caller ya lo tiene a
   * mano (p.ej. `LabOrder.prescriberId` en `lis.router.ts`) — viaja en el
   * payload del evento para que el dispatcher de notificaciones pueda
   * resolver el destinatario con un `loadUser()` directo, igual que
   * `lab.criticalValue`/`prescriberId`, sin reimplementar el join
   * personal_salud→User en Deno. Si se omite, el evento se emite igual
   * (la fila + el SLA/read-back no dependen de la notificación push) pero
   * queda sin recipient resoluble.
   */
  medicoTratanteUserId?: string | null;
  valorCritico: Record<string, unknown>;
  severidad: CriticalResultSeveridad;
  /** Default 60 — mismo default que la columna `sla_min`. */
  slaMin?: number;
  emittedById: string;
}

export interface CreateCriticalResultNotificationResult {
  notificationId: string;
  notificadoEn: Date;
}

export async function createCriticalResultNotification(
  tx: EmitDomainEventTx,
  input: CreateCriticalResultNotificationInput,
): Promise<CreateCriticalResultNotificationResult> {
  const valorJson = JSON.stringify(input.valorCritico);
  const slaMin = input.slaMin ?? 60;

  const inserted = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<Array<{ id: string; notificado_en: Date }>>)`
    INSERT INTO ece.critical_result_notification (
      organization_id,
      lab_result_id,
      paciente_id,
      medico_tratante_id,
      valor_critico,
      severidad,
      sla_min
    ) VALUES (
      ${input.organizationId}::uuid,
      ${input.labResultId}::uuid,
      ${input.pacienteId}::uuid,
      ${input.medicoTratanteId}::uuid,
      ${valorJson}::jsonb,
      ${input.severidad},
      ${slaMin}
    )
    RETURNING id::text, notificado_en
  `;

  const notif = inserted[0];
  if (!notif) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "No se pudo crear la notificación de valor crítico.",
    });
  }

  await emitDomainEvent(tx, {
    organizationId: input.organizationId,
    eventType: "critical_result.emitted",
    aggregateType: "CriticalResultNotification",
    aggregateId: notif.id,
    emittedById: input.emittedById,
    payload: {
      labResultId: input.labResultId,
      pacienteId: input.pacienteId,
      medicoTratanteId: input.medicoTratanteId,
      medicoTratanteUserId: input.medicoTratanteUserId ?? null,
      severidad: input.severidad,
      slaMin,
      valorCritico: input.valorCritico,
    },
  });

  return { notificationId: notif.id, notificadoEn: notif.notificado_en };
}
