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
 * se inserten dentro de la MISMA transacción Prisma que la mutación clínica
 * (encounter-transfer.router.ts, encounter-discharge.router.ts) — esos routers
 * corren en `ctx.prisma.$transaction` plano, sin demotar. `encounter.router.ts`
 * (`admit`) en cambio llama a esta función dentro de un `withTenantContext` YA
 * demotado a `authenticated`. Esta función no sabe, y no debe necesitar saber,
 * cuál de los dos casos aplica.
 *
 * Por eso el demote/restore NO usa `RESET ROLE`: `RESET ROLE` no es un "pop" del
 * último `SET ROLE` — vuelve directo al rol de sesión (`session_user`), que en
 * Supabase tiene BYPASSRLS. Si el caller ya había demotado antes de llamar
 * (encounter.router.ts `admit`), `RESET ROLE` deshace TAMBIÉN ese demote,
 * dejando el resto de la transacción corriendo bypass-RLS en silencio — hallazgo
 * de @QA. Hoy es inofensivo porque la llamada es la última operación de ese
 * callback, pero es un contrato frágil: dos líneas agregadas después reabren el
 * hueco sin que nada lo señale.
 *
 * Fix: capturamos el rol activo (`current_user`) ANTES de demotar y lo
 * restauramos explícitamente al final (`SET LOCAL ROLE "<rol capturado>"`) en
 * vez de `RESET ROLE`. Es correcto sea que el caller haya demotado antes
 * (restaura a `authenticated`) o no (restaura al rol de sesión original,
 * idéntico al comportamiento previo de `RESET ROLE` para ese caso) — sin que el
 * caller tenga que declarar nada ni que esta función deba ser la última
 * operación del callback. Elimina el contrato frágil en vez de documentarlo.
 */
import { z } from "zod";
import {
  epcisPatientWhatSchema,
  epcisPatientWhereSchema,
  epcisPatientWhySchema,
  epcisPatientWhoSchema,
} from "@his/contracts";
import type { EpcisPatientEventRow } from "./epcis-builder";

type TxLike = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

const epcisPatientPayloadSchema = z
  .object({
    what: epcisPatientWhatSchema,
    where_data: epcisPatientWhereSchema,
    why: epcisPatientWhySchema,
    who: epcisPatientWhoSchema,
  })
  .strict();

/**
 * Dictamen @AE §4 restricción 4: payload what/where_data/why/who limitado a
 * identificadores opacos, validado por Zod en el borde de persistencia — no
 * solo por TypeScript + tests de cumplimiento (epcis-builder.test.ts). Lanza
 * si el payload no calza con el shape esperado; el INSERT nunca llega a
 * ejecutarse con un payload inválido.
 */
function assertOpaquePayload(row: EpcisPatientEventRow): void {
  const result = epcisPatientPayloadSchema.safeParse({
    what: row.what,
    where_data: row.where_data,
    why: row.why,
    who: row.who,
  });
  if (!result.success) {
    throw new Error(
      `[EPCIS] payload de evento de paciente no cumple el schema opaco (dictamen @AE §4.4): ${result.error.message}`,
    );
  }
}

export async function persistPatientMovementEvent(
  tx: TxLike,
  recordedById: string,
  eceEstablecimientoId: string,
  row: EpcisPatientEventRow,
): Promise<void> {
  assertOpaquePayload(row);

  const callerRoleRows = await tx.$queryRawUnsafe<Array<{ current_user: string }>>(
    `SELECT current_user`,
  );
  const callerRole = callerRoleRows[0]?.current_user;
  if (!callerRole) {
    throw new Error(
      "[EPCIS] no se pudo determinar el rol Postgres activo antes de demotar a authenticated",
    );
  }

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

  // Restaura el rol EXACTO capturado arriba — NUNCA `RESET ROLE` (ver header).
  await tx.$executeRawUnsafe(`SET LOCAL ROLE "${callerRole.replace(/"/g, '""')}"`);
}
