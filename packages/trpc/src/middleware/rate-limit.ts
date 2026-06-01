/**
 * Rate-limiter compartido (Postgres) para endpoints de auth.
 *
 * Historia: nació in-memory (S-K-2 cierra K-04, PR #430) con un `Map` por
 * proceso. En Vercel serverless multi-pod cada instancia tenía su propio
 * contador → un atacante distribuido evadía el límite global. Sprint 5
 * Beta.22 lo migró a Postgres (tabla `RateLimitHit`) para estado compartido.
 *
 * Diseño:
 *   - Ventana deslizante por `bucketKey`: contar hits con `occurredAt` dentro
 *     de la ventana; si `>= max` rechazar (sin registrar); si no, insertar.
 *   - `bucketKey` codifica el contexto (tipo + IP/email/userId) — ver call sites.
 *   - Defensa por superposición: limitar por IP Y por email/userId con keys
 *     distintas (atacante con muchos proxies sigue limitado por target).
 *   - Falla cerrada: si `ip`/`email` son undefined → "unknown" (comparten cubeta).
 *
 * NO es tenant-scoped: es seguridad de plataforma. El insert/count corre con
 * el `ctx.prisma` base (rol BYPASSRLS) FUERA de `withTenantContext`. La tabla
 * tiene RLS habilitada sin policies (deny-all a anon/authenticated).
 *
 * Atomicidad: count-luego-insert no es atómico, pero la carrera es benigna
 * para rate-limiting (bajo concurrencia extrema podrían colarse 1-2 extra).
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

/**
 * Interfaz mínima del store que necesita el rate-limiter. Permite inyectar
 * `ctx.prisma` en runtime y un mock en tests sin acoplar al PrismaClient completo.
 */
export interface RateLimitStore {
  rateLimitHit: {
    count(args: {
      where: { bucketKey: string; occurredAt: { gte: Date } };
    }): Promise<number>;
    findFirst(args: {
      where: { bucketKey: string; occurredAt: { gte: Date } };
      orderBy: { occurredAt: "asc" };
      select: { occurredAt: true };
    }): Promise<{ occurredAt: Date } | null>;
    create(args: { data: { bucketKey: string } }): Promise<unknown>;
  };
}

/**
 * Verifica (y registra) un intento contra la ventana deslizante en Postgres.
 * Si el límite se alcanzó NO registra el intento (preserva la semántica
 * in-memory previa: la cubeta se vacía al expirar el más viejo).
 */
export async function checkRateLimit(
  store: RateLimitStore,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = Date.now();
  const since = new Date(now - opts.windowMs);

  const count = await store.rateLimitHit.count({
    where: { bucketKey: opts.key, occurredAt: { gte: since } },
  });

  if (count >= opts.max) {
    const oldest = await store.rateLimitHit.findFirst({
      where: { bucketKey: opts.key, occurredAt: { gte: since } },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    });
    const oldestMs = oldest ? oldest.occurredAt.getTime() : now;
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((opts.windowMs - (now - oldestMs)) / 1000)),
    };
  }

  await store.rateLimitHit.create({ data: { bucketKey: opts.key } });
  return { ok: true };
}

/**
 * Wrapper que lanza `TOO_MANY_REQUESTS` cuando el límite se supera.
 * Mensaje user-friendly incluye `retryAfterSec` para que UI muestre cuenta atrás.
 */
export async function rateLimitOrThrow(
  store: RateLimitStore,
  opts: RateLimitOptions,
): Promise<void> {
  const result = await checkRateLimit(store, opts);
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
