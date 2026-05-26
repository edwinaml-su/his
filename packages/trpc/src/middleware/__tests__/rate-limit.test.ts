/**
 * Tests del rate-limiter in-memory (K-04 audit Stream K).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  _resetRateLimitForTesting,
  checkRateLimit,
  normalizeIp,
  rateLimitOrThrow,
} from "../rate-limit";

describe("rate-limit", () => {
  beforeEach(() => {
    _resetRateLimitForTesting();
  });

  describe("checkRateLimit", () => {
    it("admite hasta `max` intentos en la ventana", () => {
      for (let i = 0; i < 5; i++) {
        const r = checkRateLimit({ key: "test:k1", max: 5, windowMs: 60_000 });
        expect(r.ok).toBe(true);
      }
    });

    it("bloquea el intento #max+1 con retryAfterSec > 0", () => {
      for (let i = 0; i < 5; i++) {
        checkRateLimit({ key: "test:k2", max: 5, windowMs: 60_000 });
      }
      const r = checkRateLimit({ key: "test:k2", max: 5, windowMs: 60_000 });
      expect(r.ok).toBe(false);
      expect(r.retryAfterSec).toBeGreaterThan(0);
      expect(r.retryAfterSec).toBeLessThanOrEqual(60);
    });

    it("keys distintas no se interfieren", () => {
      for (let i = 0; i < 5; i++) {
        checkRateLimit({ key: "test:alice", max: 5, windowMs: 60_000 });
      }
      // alice agotada, pero bob fresh
      expect(checkRateLimit({ key: "test:bob", max: 5, windowMs: 60_000 }).ok).toBe(true);
      expect(checkRateLimit({ key: "test:alice", max: 5, windowMs: 60_000 }).ok).toBe(false);
    });
  });

  describe("rateLimitOrThrow", () => {
    it("no lanza dentro del límite", () => {
      expect(() =>
        rateLimitOrThrow({ key: "throw:ok", max: 3, windowMs: 60_000 }),
      ).not.toThrow();
    });

    it("lanza TRPCError TOO_MANY_REQUESTS cuando supera", () => {
      rateLimitOrThrow({ key: "throw:over", max: 1, windowMs: 60_000 });
      expect(() =>
        rateLimitOrThrow({ key: "throw:over", max: 1, windowMs: 60_000 }),
      ).toThrowError(/Demasiados intentos/);
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
