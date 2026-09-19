/**
 * CC-A (auditoría 2026-09-18, hallazgo P0) — resolución real de tipo de
 * cambio funcional.
 *
 * Antes de este helper, 4 puntos hardcodeaban `exchangeRateToFunc: 1` sin
 * verificar si la moneda de la operación era realmente la funcional de la
 * organización (`encounter.router.ts#admit`, `triage.router.ts` admisión NN,
 * `admision-ambulatoria.ts`, `invoice.router.ts#create`). Con una sola
 * organización operando en su propia moneda el bug era invisible; en
 * multipaís/multimoneda produce totales financieros incorrectos en silencio.
 *
 * Filosofía (misma que PENDIENTE_TARIFA en price-resolver.ts): el dinero no
 * se inventa. Si la moneda de la operación difiere de la funcional y no hay
 * una tasa vigente registrada, se lanza `PRECONDITION_FAILED` — nunca se
 * devuelve 1 en silencio.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { RATE_TYPE_FALLBACK, type FxRateType } from "../routers/currency.router";

type TxParaTasa = Pick<PrismaClient, "exchangeRate">;
type TxParaOrg = Pick<PrismaClient, "organization">;

interface TasaVigenteRow {
  rate: { toNumber: () => number };
  rateType: FxRateType;
}

/**
 * Busca la tasa vigente `from -> to` al momento `at` (default: ahora).
 * Si no se especifica `rateType`, prueba en el mismo orden de preferencia
 * que `currencyRouter.getRate` (OFFICIAL → AVERAGE → FISCAL → SELL → BUY) —
 * reutilizado desde ahí para no mantener dos listas de preferencia.
 */
export async function buscarTasaVigente(
  tx: TxParaTasa,
  params: { from: string; to: string; at?: Date; rateType?: FxRateType },
): Promise<TasaVigenteRow | null> {
  const at = params.at ?? new Date();
  const types = params.rateType ? [params.rateType] : [...RATE_TYPE_FALLBACK];

  for (const rateType of types) {
    const row = await tx.exchangeRate.findFirst({
      where: {
        fromCurrency: params.from,
        toCurrency: params.to,
        rateType,
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gt: at } }],
      },
      orderBy: { validFrom: "desc" },
    });
    if (row) return row;
  }
  return null;
}

export interface ResolverTasaFuncionalParams {
  organizationId: string;
  currencyId: string;
  /**
   * Moneda funcional de la organización, si el caller ya la tiene cargada
   * (p. ej. ya hizo `organization.findUnique` para otro fin) — evita un
   * SELECT extra. Si se omite, se resuelve aquí.
   */
  functionalCurrencyId?: string;
  /** Momento para el que se resuelve la tasa vigente (default: ahora). */
  at?: Date;
}

/**
 * Resuelve `exchangeRateToFunc`: la tasa de `currencyId` hacia la moneda
 * funcional de la organización.
 *
 * - Si `currencyId` YA es la funcional ⇒ `1` (camino corto, sin query a
 *   `ExchangeRate`).
 * - Si es otra moneda, busca la tasa vigente (ver `buscarTasaVigente`).
 * - Si no hay tasa vigente ⇒ `TRPCError PRECONDITION_FAILED` con mensaje
 *   accionable. NUNCA retorna 1 silencioso para una moneda distinta a la
 *   funcional.
 */
export async function resolverTasaFuncional(
  tx: TxParaTasa & TxParaOrg,
  params: ResolverTasaFuncionalParams,
): Promise<number> {
  const functionalCurrencyId =
    params.functionalCurrencyId ??
    (
      await tx.organization.findUnique({
        where: { id: params.organizationId },
        select: { functionalCurrency: true },
      })
    )?.functionalCurrency;

  if (!functionalCurrencyId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "La organización no tiene moneda funcional configurada.",
    });
  }

  if (params.currencyId === functionalCurrencyId) {
    return 1;
  }

  const vigente = await buscarTasaVigente(tx, {
    from: params.currencyId,
    to: functionalCurrencyId,
    at: params.at,
  });

  if (!vigente) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "No hay tasa de cambio vigente registrada para esta moneda. Registre la tasa en /admin/exchange-rates.",
    });
  }

  return vigente.rate.toNumber();
}
