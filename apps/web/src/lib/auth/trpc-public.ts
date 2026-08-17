/**
 * Allowlist de procedures tRPC accesibles sin sesión — OWASP A01:2025.
 *
 * Historia: `/api/trpc` entero estaba en `PUBLIC_PATHS` (hallazgo A05-2 del
 * pentest 2026-05-30). Beta.21 lo cerró dejando prefijos públicos, pero la
 * comparación era `pathname.startsWith(prefix)` sobre la ruta completa — y
 * `httpBatchLink` codifica el batch como `/api/trpc/proc1,proc2`. Bastaba con
 * poner un procedure público de primero (`/api/trpc/locale.x,patient.list`)
 * para que TODO el batch pasara el gate del edge.
 *
 * Aquí se parsea el batch y se exige que CADA procedure esté en la allowlist.
 * (El `tenantProcedure` del router sigue siendo la defensa real; esto es el
 * gate de borde que debe ser correcto por sí mismo.)
 *
 * El parseo del batch (`proc1,proc2` → `["proc1","proc2"]`) vive en
 * `@/lib/trpc/parse-batch` — compartido con el rate limit global (H1), que
 * necesita la MISMA lista de procedures para no divergir del gate de aquí.
 *
 * Si se agrega un `publicProcedure` nuevo, añadir su prefijo aquí.
 */
import { parseTrpcBatchPath } from "@/lib/trpc/parse-batch";

/** Procedures (o prefijos de router) que usan `publicProcedure`. */
export const TRPC_PUBLIC_PREFIXES = [
  "currency.", // currency.list, currency.exchangeRates (catálogos)
  "country.", // country.list (catálogo)
  "locale.", // locale.geoDivisions, locale.holidays, locale.currentLocale
  "portal.", // portal.register/verifyEmail/requestLogin/verifyLogin
  "firma.requestRecovery", // recuperación de PIN pre-sesión
  "firma.completeRecovery",
];

/**
 * ¿La ruta tRPC es 100% pública? Falso para cualquier batch que incluya al
 * menos un procedure no listado (fail-closed).
 */
export function isPublicTrpcPath(pathname: string): boolean {
  const procedures = parseTrpcBatchPath(pathname);
  if (!procedures) return false;

  return procedures.every((proc) =>
    TRPC_PUBLIC_PREFIXES.some((prefix) => proc === prefix || proc.startsWith(prefix)),
  );
}
