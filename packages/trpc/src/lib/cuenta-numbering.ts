/**
 * CC-0002 Sprint C — Generador de número de cuenta de paciente.
 *
 * Formato: CTA{NNNNN}  (ej. CTA00001, CTA00042)
 * Correlativo por paciente: la unicidad la garantiza el upsert
 * INSERT ... ON CONFLICT DO UPDATE de fn_next_cuenta (SECURITY DEFINER).
 *
 * Debe llamarse DENTRO de una transacción Prisma activa.
 */

/** Tipo mínimo del cliente de transacción que necesita este helper. */
type TxForCuenta = {
  $queryRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown[]>;
};

/**
 * Genera el siguiente número de cuenta para el paciente dado.
 *
 * @param tx        - cliente Prisma dentro de una transacción activa
 * @param patientId - UUID del paciente (determina el bucket de secuencia)
 * @returns número formateado, ej. 'CTA00001'
 */
export async function nextCuenta(tx: TxForCuenta, patientId: string): Promise<string> {
  const rows = (await tx.$queryRaw`
    SELECT public.fn_next_cuenta(${patientId}::uuid) AS n
  `) as Array<{ n: number }>;

  const n = rows[0]?.n;
  if (n == null) {
    throw new Error(`fn_next_cuenta no devolvió valor para ${patientId}`);
  }

  return `CTA${String(n).padStart(5, "0")}`;
}
