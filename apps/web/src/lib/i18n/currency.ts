/**
 * CC-A (auditoría 2026-09-18, P1) — `formatCurrency` central.
 *
 * Antes del barrido, ~40 sitios en `apps/web/src` formateaban moneda con
 * `` `$${n.toFixed(2)}` `` (siempre USD, sin locale) y 5 con
 * `Intl.NumberFormat(..., { currency: "USD" })` repetido inline. Ninguno
 * podía mostrar una moneda distinta (ej. GTQ) sin tocar cada sitio.
 *
 * `formatCurrencySV` (`./sv.ts`) sigue viva — la usa la página de demo de
 * convenciones es-SV y tiene una rama especial no-Intl para "SVC" (colón,
 * símbolo `₡` + sufijo, no representable con `Intl.NumberFormat` estándar).
 * No se fusiona esa rama especial acá; solo delega el caso USD.
 */

/** `Intl.NumberFormat` con `style: "currency"`. Tolerante a null/undefined/NaN → "—". */
export function formatCurrency(
  amount: number | null | undefined,
  currency = "USD",
  locale = "es-SV",
): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}
