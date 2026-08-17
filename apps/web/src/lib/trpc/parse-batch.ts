/**
 * Parser compartido del batch tRPC — OWASP A01:2025 / A06:2025.
 *
 * `httpBatchLink` codifica varios procedures en un solo POST como
 * `/api/trpc/proc1,proc2,...`. Tanto el gate de allowlist pública
 * (`@/lib/auth/trpc-public`) como el rate limit global (`rate-limit-global.ts`
 * + `app/api/trpc/[trpc]/route.ts`) necesitan la MISMA lista de procedures
 * del batch — si divergen, uno puede ver "1 proc" y el otro "3 procs" para
 * la misma request.
 *
 * Devuelve `null` si el pathname no es una ruta de batch tRPC válida (no
 * empieza con el prefijo, URI malformada, segmento vacío) — fail-closed: el
 * llamador debe tratar `null` como "no se puede afirmar nada bueno de este
 * batch" (no público, no un tamaño de batch confiable).
 */
const TRPC_PREFIX = "/api/trpc/";

export function parseTrpcBatchPath(pathname: string): string[] | null {
  if (!pathname.startsWith(TRPC_PREFIX)) return null;

  const raw = pathname.slice(TRPC_PREFIX.length).split(",");
  const procedures: string[] = [];
  for (const segment of raw) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment).trim();
    } catch {
      // URI malformada: no se puede afirmar nada del batch.
      return null;
    }
    if (decoded.length === 0) return null;
    procedures.push(decoded);
  }

  return procedures.length > 0 ? procedures : null;
}
