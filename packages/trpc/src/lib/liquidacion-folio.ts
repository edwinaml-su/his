/**
 * CC-0036 Ola 5 (REQ-HIS-AFIL-001 US.AFIL.1.7 AC1) — Generador de folio de
 * `Liquidacion`.
 *
 * Formato: LIQ-{NNNNNN} (ej. LIQ-000001). Correlativo atómico por
 * organización — la unicidad la garantiza el upsert
 * INSERT ... ON CONFLICT DO UPDATE de fn_next_liquidacion (SECURITY DEFINER,
 * sql/248). Mismo patrón que `nextContratoFolio` (contrato-folio.ts).
 *
 * Debe llamarse DENTRO de una transacción Prisma activa.
 */

/** Tipo mínimo del cliente de transacción que necesita este helper. */
type TxForLiquidacionFolio = {
  $queryRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown[]>;
};

export async function nextLiquidacionFolio(
  tx: TxForLiquidacionFolio,
  organizationId: string,
): Promise<string> {
  const rows = (await tx.$queryRaw`
    SELECT public.fn_next_liquidacion(${organizationId}::uuid) AS n
  `) as Array<{ n: number }>;

  const n = rows[0]?.n;
  if (n == null) {
    throw new Error(`fn_next_liquidacion no devolvió valor para ${organizationId}`);
  }

  return `LIQ-${String(n).padStart(6, "0")}`;
}
