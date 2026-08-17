/**
 * Rate limit global del endpoint tRPC — OWASP A06:2025 (Insecure Design).
 *
 * Antes de esto sólo 3 routers de auth (firma, mfa, portal) tenían límite:
 * cualquiera podía llamar mutations costosas (crear pacientes, firmar
 * documentos, generar correlativos) en bucle contra `/api/trpc/*` sin freno.
 *
 * Dos regímenes, por coste y por modelo de amenaza distintos:
 *
 *  1. SIN sesión → ventana compartida en Postgres (`RateLimitHit`), por IP.
 *     Es la superficie pre-auth (`publicProcedure`: portal.register,
 *     firma.requestRecovery, catálogos). Volumen bajo, el coste de 2 queries
 *     por request es aceptable y el atacante distribuido debe verse frenado
 *     globalmente, no por pod.
 *
 *  2. CON sesión → ventana en memoria del proceso, por usuario. La app hace
 *     decenas de llamadas tRPC por pantalla (polling de censo, badges,
 *     dashboards): meterle 2 queries extra a cada una duplicaría la carga de
 *     BD del sistema entero. El límite por pod NO frena a un atacante
 *     distribuido — pero para llegar aquí hay que tener sesión válida, y el
 *     objetivo es amortiguar bucles y scraping, no autenticación. El abuso
 *     autenticado se persigue además por auditoría (`audit.audit_log`).
 *
 * Los umbrales son deliberadamente altos: esto es un tope anti-bucle, no una
 * cuota de negocio. Si un usuario legítimo los toca, es un bug de la UI.
 *
 * H1 (2026-08-17): `httpBatchLink` empaqueta N procedures en un solo POST.
 * Contar "1 request HTTP = 1 hit" dejaba pasar un batch de cientos de
 * mutations por el límite de 60/min. Ahora `checkTrpcRateLimit` recibe
 * `count` (nº de procedures del batch, parseado por `parse-batch.ts` en el
 * route handler) y consume esa cantidad de cupo de una vez — un batch de 15
 * procedures cuesta 15 hits, no 1. El tamaño del batch en sí está topado por
 * `TRPC_MAX_BATCH_SIZE` (`batch-limit.ts`), validado en el route handler
 * ANTES de llegar aquí.
 */
import { checkRateLimit, normalizeIp, type RateLimitStore } from "@his/trpc/middleware/rate-limit";

/** Máximo de requests tRPC por usuario autenticado y ventana. */
const AUTHED_MAX = 600;
/** Máximo de requests tRPC anónimas por IP y ventana. */
const ANON_MAX = 60;
const WINDOW_MS = 60_000;

interface Bucket {
  /** Timestamps (ms) de los hits dentro de la ventana. */
  hits: number[];
}

const buckets = new Map<string, Bucket>();
/** Cota dura del Map para que un atacante no lo haga crecer sin límite. */
const MAX_BUCKETS = 10_000;

/** Purga buckets vacíos; se llama de forma oportunista, no por timer. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    const alive = bucket.hits.filter((t) => now - t < WINDOW_MS);
    if (alive.length === 0) buckets.delete(key);
    else bucket.hits = alive;
  }
}

export interface RateLimitVerdict {
  ok: boolean;
  retryAfterSec?: number;
}

/**
 * Ventana deslizante en memoria (por proceso). Usada para tráfico autenticado.
 * `weight` (default 1) es cuántos hits registrar de una vez — ver nota H1
 * arriba. `now` va ANTES de `weight` en la firma para no romper los call
 * sites/tests existentes que pasan `now` como 3er argumento posicional.
 */
export function checkInProcessLimit(
  key: string,
  max: number,
  now = Date.now(),
  weight = 1,
): RateLimitVerdict {
  if (buckets.size > MAX_BUCKETS) sweep(now);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < WINDOW_MS);

  if (bucket.hits.length + weight > max) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000)) };
  }

  for (let i = 0; i < weight; i++) bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true };
}

/**
 * Aplica el límite que corresponda a la request. `userId` null = anónima.
 * Nunca lanza: ante un fallo del store devuelve `ok` (el rate limit no puede
 * tumbar la atención clínica; el resto de controles siguen aplicando).
 */
export async function checkTrpcRateLimit(
  store: RateLimitStore,
  {
    userId,
    ip,
    count = 1,
  }: { userId: string | null; ip: string | null | undefined; count?: number },
): Promise<RateLimitVerdict> {
  if (userId) {
    return checkInProcessLimit(`trpc:user:${userId}`, AUTHED_MAX, Date.now(), count);
  }
  try {
    const result = await checkRateLimit(store, {
      key: `trpc:anon:${normalizeIp(ip)}`,
      max: ANON_MAX,
      windowMs: WINDOW_MS,
      weight: count,
    });
    return result;
  } catch {
    return { ok: true };
  }
}

/** Solo para tests: vacía el estado en memoria entre casos. */
export function __resetInProcessLimits(): void {
  buckets.clear();
}
