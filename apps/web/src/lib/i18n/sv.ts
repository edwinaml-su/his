/**
 * US-7.4 — Formatters locale es-SV.
 * TDR §27.4 (fecha/número/moneda) y §27.5 (Bitcoin).
 *
 * Convenciones SV:
 *  - Fecha:   DD/MM/AAAA (24h sin AM/PM en MVP).
 *  - Número:  separador de miles `,`, decimal `.` (heredado del USD).
 *  - Moneda:  USD por defecto; SVC y BTC también soportadas.
 *  - Bitcoin: presentamos en BTC (no sats) con 8 decimales — es la unidad
 *             canónica del activo y la que el usuario compara con tipos de
 *             cambio. El input recibe "sats" porque la base BD las almacena
 *             como integer (sin pérdida de precisión, TDR §27.5).
 */

const LOCALE_SV = "es-SV";
const TZ_SV = "America/El_Salvador";

/** Formato DD/MM/AAAA. Acepta `Date | string | number`. */
export function formatDateSV(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  // Forzamos timezone SV para evitar drift por UTC.
  const fmt = new Intl.DateTimeFormat(LOCALE_SV, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TZ_SV,
  });
  // Intl es-SV emite "dd/mm/aaaa" — normalizamos espacios y separadores.
  const parts = fmt.formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  return `${day}/${month}/${year}`;
}

/** Número con separador `,` para miles y `.` para decimales. */
export function formatNumberSV(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Moneda. `currency` ISO-4217 (USD/SVC). Para SVC se usa el símbolo `₡`
 * y se sufija " SVC" para distinguir del colón costarricense.
 */
export function formatCurrencySV(amount: number, currency: "USD" | "SVC" = "USD"): string {
  if (!Number.isFinite(amount)) return "";
  const number = formatNumberSV(amount, 2);
  if (currency === "SVC") return `₡${number} SVC`;
  return `$${number}`;
}

/**
 * Bitcoin — TDR §27.5.
 *
 * Recibe `sats` (1 BTC = 100_000_000 sats) y devuelve la representación en
 * BTC con 8 decimales y prefijo `₿`. Mantenemos la precisión usando enteros
 * y dividiendo solo al formato. Sufijamos " BTC" por consistencia con SVC.
 */
export function formatBitcoinSV(sats: number | bigint): string {
  const satsBig = typeof sats === "bigint" ? sats : BigInt(Math.trunc(sats));
  const SAT_PER_BTC = 100_000_000n;
  const negative = satsBig < 0n;
  const abs = negative ? -satsBig : satsBig;
  const whole = abs / SAT_PER_BTC;
  const frac = (abs % SAT_PER_BTC).toString().padStart(8, "0");
  const wholeFmt = new Intl.NumberFormat("en-US").format(Number(whole));
  return `${negative ? "-" : ""}₿${wholeFmt}.${frac} BTC`;
}

/** Info estática de locale (consumida por `locale.router.currentLocale`). */
export const SV_LOCALE_INFO = {
  country: "SV",
  isoAlpha3: "SLV",
  locale: LOCALE_SV,
  timezone: TZ_SV,
  currency: "USD",
  dateFormat: "DD/MM/AAAA",
} as const;

export type SVLocaleInfo = typeof SV_LOCALE_INFO;
