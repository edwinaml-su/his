/**
 * CC-0002 Sprint A — Generador de número de expediente único.
 *
 * Formato: {PAIS}{AA}{NNNNN}
 *   - PAIS  → ISO 3166-1 alfa-2 del país de la organización (ej. SV, GT, HN)
 *   - AA    → 2 últimos dígitos del año de nacimiento del paciente (ej. 84, 04)
 *   - NNNNN → correlativo de 5 dígitos con ceros, versionado por (PAIS, AA)
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

/**
 * Genera el siguiente expediente para el paciente dado el país y birthDate.
 *
 * @param tx            - cliente Prisma dentro de una transacción activa
 * @param countryAlpha2 - código ISO alfa-2 del país (ej. 'SV')
 * @param birthDate     - fecha de nacimiento del paciente (determina el AA)
 * @returns expediente formateado, ej. 'SV8400001'
 */
export async function nextExpediente(
  tx: TxForExpediente,
  countryAlpha2: string,
  birthDate: Date,
): Promise<string> {
  const aa = String(birthDate.getUTCFullYear()).slice(-2);

  const rows = await tx.$queryRaw`
    SELECT public.fn_next_expediente(${countryAlpha2}::char(2), ${aa}::char(2)) AS n
  ` as Array<{ n: number }>;

  const n = rows[0]?.n;
  if (n == null) {
    throw new Error(`fn_next_expediente no devolvió valor para (${countryAlpha2}, ${aa})`);
  }

  return `${countryAlpha2}${aa}${String(n).padStart(5, "0")}`;
}
