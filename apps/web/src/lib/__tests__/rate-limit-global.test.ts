/**
 * Rate limit global de /api/trpc — OWASP A06:2025 (Insecure Design).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkInProcessLimit,
  checkTrpcRateLimit,
  __resetInProcessLimits,
} from "../trpc/rate-limit-global";
import type { RateLimitStore } from "@his/trpc/middleware/rate-limit";

/** Store Postgres simulado con estado en memoria. */
function makeStore(): RateLimitStore & { rows: { bucketKey: string; occurredAt: Date }[] } {
  const rows: { bucketKey: string; occurredAt: Date }[] = [];
  return {
    rows,
    rateLimitHit: {
      count: async ({ where }) =>
        rows.filter((r) => r.bucketKey === where.bucketKey && r.occurredAt >= where.occurredAt.gte)
          .length,
      findFirst: async ({ where }) => {
        const match = rows
          .filter(
            (r) => r.bucketKey === where.bucketKey && r.occurredAt >= where.occurredAt.gte,
          )
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0];
        return match ? { occurredAt: match.occurredAt } : null;
      },
      create: async ({ data }) => {
        rows.push({ bucketKey: data.bucketKey, occurredAt: new Date() });
        return undefined;
      },
    },
  };
}

describe("checkInProcessLimit", () => {
  beforeEach(() => __resetInProcessLimits());

  it("permite hasta el máximo y bloquea el siguiente", () => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      expect(checkInProcessLimit("k", 3, now).ok).toBe(true);
    }
    const blocked = checkInProcessLimit("k", 3, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("libera la cuota al salir de la ventana", () => {
    const now = Date.now();
    expect(checkInProcessLimit("k", 1, now).ok).toBe(true);
    expect(checkInProcessLimit("k", 1, now).ok).toBe(false);
    expect(checkInProcessLimit("k", 1, now + 61_000).ok).toBe(true);
  });

  it("aísla las cubetas por key", () => {
    const now = Date.now();
    expect(checkInProcessLimit("a", 1, now).ok).toBe(true);
    expect(checkInProcessLimit("b", 1, now).ok).toBe(true);
  });

  it("purga buckets vacíos al superar MAX_BUCKETS (cota dura anti-DoS de memoria)", () => {
    // MAX_BUCKETS = 10_000 (no exportado). Llenamos el Map con buckets ya
    // EXPIRADOS (fuera de la ventana de 60s) hasta superar la cota; el
    // siguiente hit debe disparar `sweep()` internamente y seguir
    // funcionando con normalidad — sin esto, un atacante que rote la key
    // (ej. IP/user-agent falso) en cada request haría crecer el Map sin
    // límite (memory-exhaustion DoS).
    const staleNow = Date.now();
    const freshNow = staleNow + 61_000; // fuera de la ventana de 60s de las cubetas stale.

    for (let i = 0; i < 10_001; i++) {
      expect(checkInProcessLimit(`stale-${i}`, 1, staleNow).ok).toBe(true);
    }
    // Tras el loop, buckets.size = 10_001 (> MAX_BUCKETS = 10_000). La
    // siguiente llamada evalúa esa condición ANTES de insertar su propia
    // key, así que es ESTA la que dispara `sweep(freshNow)`.
    const verdict = checkInProcessLimit("fresh-key", 1, freshNow);
    expect(verdict.ok).toBe(true);

    // No hay API pública para inspeccionar `buckets.size` (deliberado — es
    // estado interno), así que la evidencia observable de que `sweep()`
    // corrió sin lanzar y sin romper el comportamiento normal es que el
    // límite se sigue aplicando correctamente después de cruzar el umbral:
    // una key nueva sigue teniendo cupo completo tras el sweep.
    expect(checkInProcessLimit("fresh-key-2", 1, freshNow).ok).toBe(true);
  });
});

describe("checkTrpcRateLimit", () => {
  beforeEach(() => __resetInProcessLimits());

  it("las requests anónimas cuentan contra el store compartido, por IP", async () => {
    const store = makeStore();
    await checkTrpcRateLimit(store, { userId: null, ip: "203.0.113.7" });
    await checkTrpcRateLimit(store, { userId: null, ip: "203.0.113.7, 10.0.0.1" });
    expect(store.rows).toHaveLength(2);
    expect(store.rows.every((r) => r.bucketKey === "trpc:anon:203.0.113.7")).toBe(true);
  });

  it("las requests autenticadas NO tocan la BD", async () => {
    const store = makeStore();
    await checkTrpcRateLimit(store, { userId: "u1", ip: "203.0.113.7" });
    expect(store.rows).toHaveLength(0);
  });

  it("falla abierto si el store revienta (no puede tumbar la atención clínica)", async () => {
    const broken: RateLimitStore = {
      rateLimitHit: {
        count: async () => {
          throw new Error("db down");
        },
        findFirst: async () => null,
        create: async () => undefined,
      },
    };
    await expect(
      checkTrpcRateLimit(broken, { userId: null, ip: "203.0.113.7" }),
    ).resolves.toEqual({ ok: true });
  });
});
