/**
 * epcis-patient-persist.ts — INSERT en ece.gs1_epcis_patient_event bajo RLS.
 *
 * ece.gs1_epcis_patient_event (ADR 0019 D5, sql/199_epcis_patient_movement.sql)
 * tiene RLS `establecimiento_id = ece.current_establecimiento_id_safe()` — un GUC
 * (`app.ece_establecimiento_id`) **distinto** del que setea `withTenantContext`
 * (`app.current_org_id`, packages/trpc/src/rls-context.ts). Son dos namespaces de
 * GUC separados (ver packages/trpc/src/ece/rls-context.ts): withTenantContext no
 * satisface la policy de esta tabla.
 *
 * D7 exige que los eventos PATIENT_TRANSFER_(DEPARTURE|ARRIVAL) y PATIENT_DISCHARGE
 * se inserten dentro de la MISMA
 * transacción Prisma que la mutación clínica (encounter-transfer.router.ts,
 * encounter-discharge.router.ts) — esos routers hoy corren en `ctx.prisma.$transaction`
 * plano, sin demotar. Envolver toda la transacción en withEceContext cambiaría el
 * comportamiento RLS de operaciones preexistentes que no son parte de esta tarea.
 * En su lugar, esta función acota el demote SOLO al INSERT: `SET LOCAL ROLE
 * authenticated` → `ece.set_ece_context(...)` (SECURITY DEFINER, funciona ya
 * demotado) → INSERT → `RESET ROLE` (vuelve al rol de sesión sin requerir
 * privilegios, ver Postgres docs RESET ROLE). El resto de la transacción —
 * antes y después de esta llamada — no se ve afectado.
 */
import type { EpcisPatientEventRow } from "./epcis-builder";

type TxLike = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
};

export async function persistPatientMovementEvent(
  tx: TxLike,
  recordedById: string,
  eceEstablecimientoId: string,
  row: EpcisPatientEventRow,
): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
  await tx.$executeRawUnsafe(
    `SELECT ece.set_ece_context($1::uuid, $2::uuid)`,
    recordedById,
    eceEstablecimientoId,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO ece.gs1_epcis_patient_event
       (tipo_evento, subtipo, what, where_data, event_time,
        why, who, payload_hash, establecimiento_id, status)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5,
             $6::jsonb, $7::jsonb, $8, $9::uuid, $10)`,
    row.tipo_evento,
    row.subtipo,
    JSON.stringify(row.what),
    JSON.stringify(row.where_data),
    row.event_time.toISOString(),
    JSON.stringify(row.why),
    JSON.stringify(row.who),
    row.payload_hash,
    row.establecimiento_id,
    row.status,
  );
  await tx.$executeRawUnsafe(`RESET ROLE`);
}
