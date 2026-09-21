/**
 * R2.2 (plan remediación 2026-09) — formateadores de fecha/hora central,
 * espejo de `formatCurrency` (`./currency.ts`, CC-A #695): funciones puras
 * con default a los valores SV exactos, SIN provider global. Reemplazan los
 * `new Date(x).toLocaleDateString("es-SV")` / `new Intl.DateTimeFormat("es-SV",
 * {...})` sueltos que había en cada página (~290 ocurrencias en todo
 * `apps/web/src` según la auditoría 2026-09-18) — esta tranche solo migra
 * finance/imaging/lab/respiratory (ver PR).
 *
 * Igual que `formatCurrency`: los call sites migrados en esta tranche NO
 * threadean todavía el locale/TZ real de la organización (eso exige
 * resolverlo server-side vía `locale.currentLocale` y pasarlo por props/
 * query a cada página — trabajo de una tranche posterior). Por ahora, cero
 * cambio observable para SV: mismo locale/TZ por default que el hardcode
 * que reemplazan.
 */

const FALLBACK_LOCALE = "es-SV";
const FALLBACK_TZ = "America/El_Salvador";

function toDate(d: Date | string | number): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Fecha corta (sin hora). Tolerante a `Date | string | number` inválido → "". */
export function formatDate(
  date: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale: string = FALLBACK_LOCALE,
): string {
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale, { timeZone: FALLBACK_TZ, ...options });
}

/** Fecha + hora. Tolerante a `Date | string | number` inválido → "". */
export function formatDateTime(
  date: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale: string = FALLBACK_LOCALE,
): string {
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { timeZone: FALLBACK_TZ, ...options });
}
