/**
 * Rate-limiter in-memory para endpoints publicProcedure de auth (S-K-2 cierra K-04).
 *
 * Diseño:
 *   - `Map<key, timestamps[]>` por proceso. Cada llamada filtra timestamps
 *     fuera de la ventana, decide si admitir, y registra el nuevo timestamp.
 *   - Cleanup oportunista cada 5 min para liberar memoria de keys sin
 *     actividad reciente.
 *   - Sin dependencia externa (Redis/Upstash) — válido para deploy MVP de
 *     1-2 instancias Vercel. Si la app escala horizontalmente, sustituir
 *     `BUCKETS` por un store compartido (ver TODO al final del archivo).
 *
 * Estrategia de keys (defensa por superposición):
 *   - `auth:request-login:ip=<ip>` — limita ráfagas globales por IP.
 *   - `auth:request-login:email=<email>` — limita per-email cross-IP
 *     (atacante con muchos proxies sigue limitado por target).
 *
 * Falla cerrada: si `ip` o `email` son `undefined`, usamos "unknown" como
 * partición — el atacante anónimo comparte cubeta con todos los anónimos.
 */
import { TRPCError } from "@trpc/server";

interface RateLimitOptions {
  /** Identificador único de la cubeta (incluye contexto: tipo + IP/email/userId). */
  key: string;
  /** Número máximo de intentos en la ventana. */
  max: number;
  /** Ancho de la ventana deslizante en milisegundos. */
  windowMs: number;
}

interface RateLimitResult {
  ok: boolean;
  /** Solo presente cuando ok=false. Cuántos segundos hasta el próximo intento permitido. */
  retryAfterSec?: number;
}

const BUCKETS = new Map<string, number[]>();
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const MAX_KEYS_BEFORE_CLEANUP = 10_000;
let lastCleanupAt = Date.now();

function maybeCleanup(now: number, windowMs: number): void {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS && BUCKETS.size < MAX_KEYS_BEFORE_CLEANUP) {
    return;
  }
  for (const [k, ts] of BUCKETS) {
    const filtered = ts.filter((t) => now - t < windowMs);
    if (filtered.length === 0) BUCKETS.delete(k);
    else BUCKETS.set(k, filtered);
  }
  lastCleanupAt = now;
}

export function checkRateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  maybeCleanup(now, opts.windowMs);

  const arr = BUCKETS.get(opts.key) ?? [];
  const fresh = arr.filter((t) => now - t < opts.windowMs);

  if (fresh.length >= opts.max) {
    BUCKETS.set(opts.key, fresh);
    const oldest = fresh[0]!;
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((opts.windowMs - (now - oldest)) / 1000)),
    };
  }

  fresh.push(now);
  BUCKETS.set(opts.key, fresh);
  return { ok: true };
}

/**
 * Wrapper que lanza `TOO_MANY_REQUESTS` cuando el límite se supera.
 * Mensaje user-friendly incluye `retryAfterSec` para que UI muestre cuenta atrás.
 */
export function rateLimitOrThrow(opts: RateLimitOptions): void {
  const result = checkRateLimit(opts);
  if (!result.ok) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Demasiados intentos. Reintente en ${result.retryAfterSec} segundos.`,
    });
  }
}

/** Sanitiza una IP para usarla como key parcial. Si null/undefined → "unknown". */
export function normalizeIp(ip: string | null | undefined): string {
  if (!ip) return "unknown";
  // x-forwarded-for puede incluir varias IPs separadas por coma; tomamos la primera.
  return ip.split(",")[0]!.trim().toLowerCase();
}

/** Solo para tests: vacía el estado interno. NO usar en producción. */
export function _resetRateLimitForTesting(): void {
  BUCKETS.clear();
  lastCleanupAt = Date.now();
}

// TODO US.S-K-X (escala horizontal): si la app crece a >2 instancias Vercel,
// reemplazar `BUCKETS` por un store compartido (Upstash Redis sliding window).
// El API público de `checkRateLimit` / `rateLimitOrThrow` se mantiene estable.
