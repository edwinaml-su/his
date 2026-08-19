/**
 * epcis-event-persist.ts — INSERT en `ece.gs1_epcis_event` bajo RLS del schema `ece`.
 *
 * Hermano de `epcis-patient-persist.ts` (ADR 0019 D5) para la tabla de eventos
 * EPCIS de PRODUCTO (`ece.gs1_epcis_event`, sql/94_farmacovigilancia_epcis.sql),
 * no de paciente. Existe por la misma razón y arregla el mismo defecto de raíz:
 *
 * 1. **Namespace de GUC.** Las policies de `ece.gs1_epcis_event` son
 *      SELECT  USING      (establecimiento_id = ece.current_establecimiento_id_safe())
 *      INSERT  WITH CHECK (establecimiento_id = ece.current_establecimiento_id_safe())
 *    y `ece.current_establecimiento_id_safe()` lee el GUC
 *    `app.ece_establecimiento_id` — que setea `withEceContext`
 *    (packages/trpc/src/ece/rls-context.ts) / `ece.set_ece_context()`, **no**
 *    `withTenantContext` (packages/trpc/src/rls-context.ts, que setea
 *    `app.current_org_id` / `app.current_user_id`). Un INSERT emitido dentro de
 *    un `withTenantContext` ya demotado a `authenticated` compara contra NULL:
 *    el `WITH CHECK` nunca matchea y Postgres responde 42501
 *    "new row violates row-level security policy", abortando la transacción
 *    completa — incluida la mutación clínica que la abrió.
 *
 * 2. **Espacio de identificadores.** `ece.gs1_epcis_event.establecimiento_id` es
 *    `NOT NULL REFERENCES ece.establecimiento(id)`, y `ece.establecimiento.id`
 *    es un uuid propio (`gen_random_uuid()`) que NO es el
 *    `public."Establishment".id` de `ctx.tenant.establishmentId` — la relación
 *    entre ambos vive en la columna `ece.establecimiento.establishment_id`
 *    (sql/56_ece_01_catalogos.sql). Pasar el id de `public."Establishment"`
 *    produce 23503 (violación de FK) aun con el contexto RLS correcto. El
 *    caller debe resolverlo con `resolveEceEstablecimientoId()`.
 *
 * Demote/restore: se captura `current_user` ANTES de demotar y se restaura ese
 * rol exacto al final. **Nunca `RESET ROLE`**: `RESET ROLE` no es un "pop" del
 * último `SET ROLE`, vuelve directo al rol de sesión (`session_user`), que en
 * Supabase tiene BYPASSRLS — si el caller ya venía demotado (que es justo el
 * caso de `bedside.router.ts`, dentro de `withTenantContext`), `RESET ROLE`
 * deshace también ese demote y deja el resto de la transacción corriendo
 * bypass-RLS en silencio. Mismo razonamiento y misma implementación que
 * `persistPatientMovementEvent`; ver su cabecera para el historial del hallazgo.
 *
 * La función es correcta llame quien llame: si el caller ya demotó, restaura a
 * `authenticated`; si no, restaura al rol de sesión original. No exige ser la
 * última operación del callback.
 */

/** Subtipos operacionales aceptados por el CHECK de `ece.gs1_epcis_event.subtipo`. */
export type Gs1EpcisSubtipo =
  | "BEDSIDE_ADMIN"
  | "PHARMACY_DISPENSE"
  | "RESERVATION"
  | "SUBSTITUTION"
  | "RETURN";

/** Tipos de evento aceptados por el CHECK de `ece.gs1_epcis_event.tipo_evento`. */
export type Gs1EpcisTipoEvento =
  | "ObjectEvent"
  | "AggregationEvent"
  | "TransactionEvent"
  | "TransformationEvent"
  | "AssociationEvent";

export interface Gs1EpcisEventRow {
  tipoEvento: Gs1EpcisTipoEvento;
  subtipo: Gs1EpcisSubtipo;
  /** WHAT — EPC list + atributos del ítem (GTIN, lote, serie, vencimiento). */
  what: Record<string, unknown>;
  /** WHERE — readPoint GLN + bizLocation GLN. */
  whereData: Record<string, unknown>;
  /** WHEN — eventTime del acto clínico (recordTime lo pone la BD). */
  eventTime: Date;
  /** WHY — businessStep + disposition. */
  why: Record<string, unknown>;
  /** WHO — GSRN profesional + GSRN paciente. */
  who: Record<string, unknown>;
  /** SHA-256 del payload (inmutabilidad). */
  payloadHash: string;
  /** FK a la indicación que originó el evento; null si no aplica. */
  indicationId: string | null;
  /** `ece.establecimiento.id` YA resuelto — NO `ctx.tenant.establishmentId`. */
  establecimientoId: string;
  status: "COMMITTED" | "PENDING";
}

type TxLike = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

export async function persistGs1EpcisEvent(
  tx: TxLike,
  personalRefId: string,
  eceEstablecimientoId: string,
  row: Gs1EpcisEventRow,
): Promise<void> {
  if (row.establecimientoId !== eceEstablecimientoId) {
    // Defensa contra el defecto #2 de la cabecera: si el row trae un id de otro
    // espacio (o de otro establecimiento) que el usado para el contexto RLS, el
    // WITH CHECK fallaría en runtime con un error opaco. Fallar acá es explícito.
    throw new Error(
      "[EPCIS] row.establecimientoId no coincide con el contexto ECE usado para el INSERT " +
        "— ambos deben ser el mismo ece.establecimiento.id resuelto por resolveEceEstablecimientoId().",
    );
  }

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
    personalRefId,
    eceEstablecimientoId,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO ece.gs1_epcis_event
       (tipo_evento, subtipo, what, where_data, event_time, record_time,
        why, who, payload_hash, indication_id, establecimiento_id, status)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $5,
             $6::jsonb, $7::jsonb, $8, $9::uuid, $10::uuid, $11)`,
    row.tipoEvento,
    row.subtipo,
    JSON.stringify(row.what),
    JSON.stringify(row.whereData),
    row.eventTime.toISOString(),
    JSON.stringify(row.why),
    JSON.stringify(row.who),
    row.payloadHash,
    row.indicationId,
    row.establecimientoId,
    row.status,
  );

  // Restaura el rol EXACTO capturado arriba — NUNCA `RESET ROLE` (ver cabecera).
  await tx.$executeRawUnsafe(`SET LOCAL ROLE "${callerRole.replace(/"/g, '""')}"`);
}
