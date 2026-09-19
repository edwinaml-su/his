/**
 * CC-A (auditoría 2026-09-18, P1) — IVA por país.
 *
 * `invoice.router.ts` tenía `IVA_RATE = 0.13` hardcodeado (13% El Salvador,
 * Art. 54 LIVA) — en Guatemala el IVA es 12%. La tasa ahora vive en
 * `Country.vatRate` (SQL 255, default 0.13 para no romper el comportamiento
 * actual de orgs sin país configurado).
 */
import type { PrismaClient } from "@prisma/client";

/** Default histórico (SV, Art. 54 LIVA) — usado si la org no tiene país configurado. */
export const DEFAULT_VAT_RATE = 0.13;

type TxParaVat = Pick<PrismaClient, "organization">;

/**
 * Resuelve el IVA del país de la organización. Se llama una vez por request
 * (dentro de la misma tx) — no se cachea a nivel de proceso porque el valor
 * puede cambiar vía `/admin/countries` sin reiniciar el servidor.
 */
export async function resolverVatRate(tx: TxParaVat, organizationId: string): Promise<number> {
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { country: { select: { vatRate: true } } },
  });
  const rate = org?.country?.vatRate;
  return rate != null ? rate.toNumber() : DEFAULT_VAT_RATE;
}
