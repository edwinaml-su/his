/**
 * CC-0002 Sprint A — Generador de número de expediente único.
 * CC-0014 — el prefijo de país pasa de alfa-2 a ISO 3166-1 numérico (3 dígitos).
 *
 * Formato: {NNN}{AA}{NNNNN}
 *   - NNN   → ISO 3166-1 numérico del país de la organización, zero-pad a 3
 *             dígitos (ej. 222 El Salvador, 320 Guatemala, 340 Honduras)
 *   - AA    → 2 últimos dígitos del año de nacimiento del paciente (ej. 84, 04)
 *   - NNNNN → correlativo de 5 dígitos con ceros, versionado por (PAIS, AA)
 *
 * El BUCKET de la secuencia (fn_next_expediente / secuencia_expediente) sigue
 * keyed por alfa-2: es un identificador interno de continuidad de correlativos,
 * no el formato de salida. Cambiar el bucket a numérico rompería la
 * continuidad de los correlativos ya emitidos (ej. SV9000003 → el próximo
 * nacido-90 de SV debe seguir siendo el correlativo 4, no reiniciar). Solo el
 * formato de salida (y la migración de expedientes existentes) cambia a numérico.
 *
 * La atomicidad la garantiza el upsert INSERT ... ON CONFLICT DO UPDATE
 * de fn_next_expediente (SECURITY DEFINER), que bloquea la fila del bucket
 * con FOR UPDATE implícito durante el UPDATE, serializando emisiones
 * concurrentes sin necesidad de advisory lock externo.
 *
 * Debe llamarse DENTRO de una transacción Prisma activa.
 */

/** Tipo mínimo del cliente de transacción que necesita este helper. */
type TxForExpediente = {
  $queryRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown[]>;
};

/** País mínimo requerido para generar el expediente. */
type CountryForExpediente = {
  /** ISO 3166-1 alfa-2 — determina el bucket de la secuencia (no cambia). */
  isoAlpha2: string;
  /** ISO 3166-1 numérico — determina el prefijo del expediente (CC-0014). */
  isoNumeric: number;
};

/**
 * Genera el siguiente expediente para el paciente dado el país y birthDate.
 *
 * @param tx        - cliente Prisma dentro de una transacción activa
 * @param country   - país de la organización (isoAlpha2 para el bucket, isoNumeric para el prefijo)
 * @param birthDate - fecha de nacimiento del paciente (determina el AA)
 * @returns expediente formateado, ej. '2228400001' (222 = El Salvador)
 */
export async function nextExpediente(
  tx: TxForExpediente,
  country: CountryForExpediente,
  birthDate: Date,
): Promise<string> {
  const { isoAlpha2, isoNumeric } = country;
  const aa = String(birthDate.getUTCFullYear()).slice(-2);

  const rows = await tx.$queryRaw`
    SELECT public.fn_next_expediente(${isoAlpha2}::char(2), ${aa}::char(2)) AS n
  ` as Array<{ n: number }>;

  const n = rows[0]?.n;
  if (n == null) {
    throw new Error(`fn_next_expediente no devolvió valor para (${isoAlpha2}, ${aa})`);
  }

  return `${String(isoNumeric).padStart(3, "0")}${aa}${String(n).padStart(5, "0")}`;
}
