/**
 * H1-07: Generador centralizado de número de encuentro.
 *
 * Anteriormente duplicado en encounter.router.ts y triage.router.ts con race
 * condition bajo concurrencia alta. Esta versión usa pg_advisory_xact_lock
 * para serializar emision de números dentro de la misma organización.
 *
 * El lock es por transacción (xact): se libera automáticamente al hacer
 * COMMIT o ROLLBACK. No requiere UNLOCK explícito.
 *
 * La clave del lock es un hash int64 derivado del organizationId (UUID).
 * Colisión de hash es teóricamente posible entre orgs distintas pero
 * extremadamente improbable — el overhead de lock en ese escenario es
 * aceptable (serializa admisiones de dos orgs, no produce datos incorrectos).
 */

/** Prisma tx client mínimo que necesita el helper. */
type TxForNumbering = {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  encounter: {
    count: (args: { where: { organizationId: string; admittedAt: { gte: Date } } }) => Promise<number>;
  };
};

/**
 * Emite el siguiente `ENC-YYYY-NNNNNN` para la organización.
 *
 * Debe llamarse DENTRO de una transacción Prisma activa:
 *   ```ts
 *   const n = await nextEncounterNumber(tx, orgId);
 *   ```
 *
 * El advisory lock serializa escrituras concurrentes del mismo org.
 * El constraint UNIQUE (organizationId, encounterNumber) actúa como
 * defensa de segunda línea si dos procesos obtienen el mismo count
 * por alguna condición de carrera no cubierta.
 */
export async function nextEncounterNumber(tx: TxForNumbering, organizationId: string): Promise<string> {
  // Hash determinista del UUID → bigint para pg_advisory_xact_lock.
  // Tomamos los primeros 8 bytes del UUID (sin guiones) como hex → int64 JS.
  // El resultado puede ser negativo (signed int64) — Postgres lo acepta.
  const hexPrefix = organizationId.replace(/-/g, "").slice(0, 16);
  const lockKey = BigInt("0x" + hexPrefix);
  // Convertir a int64 con signo para evitar overflow en Postgres bigint.
  const lockKeySigned = lockKey > BigInt("0x7FFFFFFFFFFFFFFF")
    ? lockKey - BigInt("0x10000000000000000")
    : lockKey;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKeySigned}::bigint)`;

  const year = new Date().getFullYear();
  const start = new Date(`${year}-01-01T00:00:00Z`);
  const count = await tx.encounter.count({
    where: { organizationId, admittedAt: { gte: start } },
  });
  return `ENC-${year}-${String(count + 1).padStart(6, "0")}`;
}
