/**
 * CC-0036 Ola 2 (REQ-HIS-AFIL-001 US.AFIL.1.3 AC1) — Generador de folio de
 * `ContratoArrendamiento`.
 *
 * Formato: ARR-{NNNNNN} (ej. ARR-000001, ARR-000123). Correlativo atómico
 * por organización — la unicidad la garantiza el upsert
 * INSERT ... ON CONFLICT DO UPDATE de fn_next_contrato_arrendamiento
 * (SECURITY DEFINER, sql/245). Mismo patrón que `nextCuenta`
 * (cuenta-numbering.ts).
 *
 * Debe llamarse DENTRO de una transacción Prisma activa.
 */

/** Tipo mínimo del cliente de transacción que necesita este helper. */
type TxForContratoFolio = {
  $queryRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown[]>;
};

export async function nextContratoFolio(
  tx: TxForContratoFolio,
  organizationId: string,
): Promise<string> {
  const rows = (await tx.$queryRaw`
    SELECT public.fn_next_contrato_arrendamiento(${organizationId}::uuid) AS n
  `) as Array<{ n: number }>;

  const n = rows[0]?.n;
  if (n == null) {
    throw new Error(`fn_next_contrato_arrendamiento no devolvió valor para ${organizationId}`);
  }

  return `ARR-${String(n).padStart(6, "0")}`;
}
