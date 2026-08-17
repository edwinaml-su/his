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
