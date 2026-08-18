/**
 * Parser de batch tRPC + conteo por batch — OWASP A01:2025 / A06:2025
 * (hallazgo H1, fix c440473).
 *
 * `parseTrpcBatchPath` es compartido entre el gate de allowlist pública
 * (`@/lib/auth/trpc-public`) y el rate limit global — si divergieran, uno
 * podría ver "1 proc" y el otro "3 procs" para el mismo batch.
 *
 * H1 en sí: antes de este fix, `httpBatchLink` empaquetaba N procedures en
 * un solo POST y el rate limit contaba "1 request HTTP = 1 hit" — un batch
 * de 200 mutations x60/min pasaba un límite de 60/min sin problema. Ahora
 * `checkInProcessLimit`/`checkTrpcRateLimit` reciben `weight`/`count` = nº de
 * procedures del batch y consumen esa cantidad de cupo de una sola vez.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { parseTrpcBatchPath } from "../parse-batch";
import { TRPC_MAX_BATCH_SIZE } from "../batch-limit";
import {
  checkInProcessLimit,
  checkTrpcRateLimit,
  __resetInProcessLimits,
} from "../rate-limit-global";
import type { RateLimitStore } from "@his/trpc/middleware/rate-limit";

describe("parseTrpcBatchPath", () => {
  it("pathname que no es de tRPC → null", () => {
    expect(parseTrpcBatchPath("/api/other")).toBeNull();
    expect(parseTrpcBatchPath("/api/trp/patient.list")).toBeNull();
  });

  it("un solo procedure", () => {
    expect(parseTrpcBatchPath("/api/trpc/patient.list")).toEqual(["patient.list"]);
  });

  it("varios procedures separados por coma (batch real de httpBatchLink)", () => {
    expect(parseTrpcBatchPath("/api/trpc/patient.list,patient.get,census.bedMap")).toEqual([
      "patient.list",
      "patient.get",
      "census.bedMap",
    ]);
  });

  it("decodifica segmentos URI-encoded", () => {
    expect(parseTrpcBatchPath(`/api/trpc/${encodeURIComponent("a.b")}`)).toEqual(["a.b"]);
  });

  it("fail-closed: sin procedures tras el prefijo → null", () => {
    expect(parseTrpcBatchPath("/api/trpc/")).toBeNull();
  });

  it("fail-closed: segmento vacío en medio del batch → null", () => {
    expect(parseTrpcBatchPath("/api/trpc/patient.list,,patient.get")).toBeNull();
  });

  it("fail-closed: segmento en blanco (solo espacios) → null", () => {
    expect(parseTrpcBatchPath("/api/trpc/patient.list,   ,patient.get")).toBeNull();
  });

  it("fail-closed: URI malformada → null (no lanza)", () => {
    expect(parseTrpcBatchPath("/api/trpc/%")).toBeNull();
  });
});

describe("TRPC_MAX_BATCH_SIZE — el tamaño de batch usado por el route handler para el 413", () => {
  it("un batch de exactamente el máximo permitido no se marca como excedido", () => {
    const path =
      "/api/trpc/" +
      Array.from({ length: TRPC_MAX_BATCH_SIZE }, (_, i) => `p${i}`).join(",");
    const procedures = parseTrpcBatchPath(path);
    expect(procedures).toHaveLength(TRPC_MAX_BATCH_SIZE);
    expect((procedures?.length ?? 0) > TRPC_MAX_BATCH_SIZE).toBe(false);
  });

  it("un batch que excede el máximo permitido sí se marca como excedido", () => {
    const path =
      "/api/trpc/" +
      Array.from({ length: TRPC_MAX_BATCH_SIZE + 1 }, (_, i) => `p${i}`).join(",");
    const procedures = parseTrpcBatchPath(path);
    expect(procedures).toHaveLength(TRPC_MAX_BATCH_SIZE + 1);
    expect((procedures?.length ?? 0) > TRPC_MAX_BATCH_SIZE).toBe(true);
  });
});

describe("H1 — checkInProcessLimit consume `weight` (nº de procedures del batch) de una vez", () => {
  beforeEach(() => __resetInProcessLimits());

  it("un batch de 7 procedures resta 7 de cupo, no 1", () => {
    const now = Date.now();
    // max=10: un batch de 7 deja exactamente 3 de cupo.
    expect(checkInProcessLimit("user:u1", 10, now, 7).ok).toBe(true);
    expect(checkInProcessLimit("user:u1", 10, now, 3).ok).toBe(true); // exactamente el resto
    expect(checkInProcessLimit("user:u1", 10, now, 1).ok).toBe(false); // ya no queda cupo
  });

  it("un batch que por sí solo excede el máximo se rechaza entero, sin consumir cupo parcial", () => {
    const now = Date.now();
    const verdict = checkInProcessLimit("user:u2", 5, now, 6);
    expect(verdict.ok).toBe(false);
    // el cupo sigue intacto: un batch de exactamente 5 (el máximo) pasa completo después.
    expect(checkInProcessLimit("user:u2", 5, now, 5).ok).toBe(true);
  });

  it("un batch de 1 procedure (default) se comporta igual que antes de H1", () => {
    const now = Date.now();
    expect(checkInProcessLimit("user:u3", 1, now).ok).toBe(true);
    expect(checkInProcessLimit("user:u3", 1, now).ok).toBe(false);
  });
});

describe("H1 — checkTrpcRateLimit propaga `count` al backend correspondiente", () => {
  beforeEach(() => __resetInProcessLimits());

  it("usuario autenticado: 200 batches de 3 agotan el límite en memoria (AUTHED_MAX=600) exacto", async () => {
    const store: RateLimitStore = {
      rateLimitHit: {
        count: async () => 0,
        findFirst: async () => null,
        create: async () => undefined,
      },
    };
    for (let i = 0; i < 200; i++) {
      const verdict = await checkTrpcRateLimit(store, { userId: "userX", ip: null, count: 3 });
      expect(verdict.ok).toBe(true);
    }
    const blocked = await checkTrpcRateLimit(store, { userId: "userX", ip: null, count: 1 });
    expect(blocked.ok).toBe(false);
  });

  it("anónimo: un batch de 5 procedures inserta 5 hits reales en el store compartido, no 1", async () => {
    const rows: { bucketKey: string; occurredAt: Date }[] = [];
    const store: RateLimitStore = {
      rateLimitHit: {
        count: async ({ where }) =>
          rows.filter(
            (r) => r.bucketKey === where.bucketKey && r.occurredAt >= where.occurredAt.gte,
          ).length,
        findFirst: async () => null,
        create: async ({ data }) => {
          rows.push({ bucketKey: data.bucketKey, occurredAt: new Date() });
          return undefined;
        },
      },
    };
    const verdict = await checkTrpcRateLimit(store, {
      userId: null,
      ip: "203.0.113.9",
      count: 5,
    });
    expect(verdict.ok).toBe(true);
    expect(rows).toHaveLength(5);
  });
});
