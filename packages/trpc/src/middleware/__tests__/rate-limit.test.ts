/**
 * Tests del rate-limiter compartido (Postgres) — K-04 audit Stream K + Sprint 5.
 *
 * Usa un store en-memoria que imita la interfaz `RateLimitStore` (count/findFirst/
 * create sobre `rateLimitHit`) para validar la lógica de ventana deslizante sin
 * tocar la BD real.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  normalizeIp,
  rateLimitOrThrow,
  type RateLimitStore,
} from "../rate-limit";

/**
 * Mock store: array de { bucketKey, occurredAt } en memoria. Reproduce la
 * semántica de las queries Prisma que usa el rate-limiter.
 */
function makeStore(): RateLimitStore & { _rows: { bucketKey: string; occurredAt: Date }[] } {
  const rows: { bucketKey: string; occurredAt: Date }[] = [];
  return {
    _rows: rows,
    rateLimitHit: {
      count: async ({ where }) =>
        rows.filter(
          (r) => r.bucketKey === where.bucketKey && r.occurredAt >= where.occurredAt.gte,
        ).length,
      findFirst: async ({ where }) => {
        const matches = rows
          .filter(
            (r) => r.bucketKey === where.bucketKey && r.occurredAt >= where.occurredAt.gte,
          )
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        return matches[0] ? { occurredAt: matches[0].occurredAt } : null;
      },
      create: async ({ data }) => {
        rows.push({ bucketKey: data.bucketKey, occurredAt: new Date() });
        return undefined;
      },
    },
  };
}

describe("rate-limit (Postgres-backed)", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  describe("checkRateLimit", () => {
    it("admite hasta `max` intentos en la ventana", async () => {
      for (let i = 0; i < 5; i++) {
        const r = await checkRateLimit(store, { key: "test:k1", max: 5, windowMs: 60_000 });
        expect(r.ok).toBe(true);
      }
    });

    it("bloquea el intento #max+1 con retryAfterSec > 0", async () => {
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(store, { key: "test:k2", max: 5, windowMs: 60_000 });
      }
      const r = await checkRateLimit(store, { key: "test:k2", max: 5, windowMs: 60_000 });
      expect(r.ok).toBe(false);
      expect(r.retryAfterSec).toBeGreaterThan(0);
      expect(r.retryAfterSec).toBeLessThanOrEqual(60);
    });

    it("no registra el intento cuando está sobre el límite", async () => {
      for (let i = 0; i < 3; i++) {
        await checkRateLimit(store, { key: "test:noreg", max: 3, windowMs: 60_000 });
      }
      const before = store._rows.length;
      await checkRateLimit(store, { key: "test:noreg", max: 3, windowMs: 60_000 });
      expect(store._rows.length).toBe(before); // rechazado sin insertar
    });

    it("keys distintas no se interfieren", async () => {
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(store, { key: "test:alice", max: 5, windowMs: 60_000 });
      }
      expect((await checkRateLimit(store, { key: "test:bob", max: 5, windowMs: 60_000 })).ok).toBe(
        true,
      );
      expect(
        (await checkRateLimit(store, { key: "test:alice", max: 5, windowMs: 60_000 })).ok,
      ).toBe(false);
    });
  });

  describe("rateLimitOrThrow", () => {
    it("no lanza dentro del límite", async () => {
      await expect(
        rateLimitOrThrow(store, { key: "throw:ok", max: 3, windowMs: 60_000 }),
      ).resolves.toBeUndefined();
    });

    it("lanza TRPCError TOO_MANY_REQUESTS cuando supera", async () => {
      await rateLimitOrThrow(store, { key: "throw:over", max: 1, windowMs: 60_000 });
      await expect(
        rateLimitOrThrow(store, { key: "throw:over", max: 1, windowMs: 60_000 }),
      ).rejects.toThrowError(/Demasiados intentos/);
    });
  });

  describe("normalizeIp", () => {
    it("acepta IP single", () => {
      expect(normalizeIp("203.0.113.1")).toBe("203.0.113.1");
    });

    it("toma la primera IP de un header con varias (x-forwarded-for)", () => {
      expect(normalizeIp("203.0.113.1, 198.51.100.2, 192.0.2.3")).toBe("203.0.113.1");
    });

    it("lowercase IPv6", () => {
      expect(normalizeIp("FE80::1")).toBe("fe80::1");
    });

    it("undefined / null → 'unknown'", () => {
      expect(normalizeIp(undefined)).toBe("unknown");
      expect(normalizeIp(null)).toBe("unknown");
    });

    it("string vacío → 'unknown'", () => {
      expect(normalizeIp("")).toBe("unknown");
    });
  });
});
