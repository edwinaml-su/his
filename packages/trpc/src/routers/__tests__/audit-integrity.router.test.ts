/**
 * Tests del auditIntegrityRouter (verifyChain, chainStats).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { auditIntegrityRouter } from "../audit-integrity.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const SUPER_ADMIN_CTX_OVERRIDES = {
  tenant: { ...MOCK_TENANT, roleCodes: ["super_admin"] },
};

describe("auditIntegrityRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ------------------------------------------------------------------ verifyChain
  describe("verifyChain", () => {
    it("retorna ok=true y breaks=[] cuando la cadena esta integra", async () => {
      // Primera llamada: fn_verify_chain (sin breaks), segunda: COUNT
      prisma.$queryRaw
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{ total: BigInt(100) }] as never);

      const caller = auditIntegrityRouter.createCaller(makeCtx({ prisma, ...SUPER_ADMIN_CTX_OVERRIDES }));
      const result = await caller.verifyChain({ fromId: 0 });

      expect(result.ok).toBe(true);
      expect(result.breaks).toHaveLength(0);
      expect(result.totalRows).toBe(100);
    });

    it("retorna ok=false y lista breaks cuando la cadena tiene roturas", async () => {
      const breakRow = {
        broken_id: BigInt(42),
        expected_hash: "aaaa",
        actual_hash: "bbbb",
      };
      prisma.$queryRaw
        .mockResolvedValueOnce([breakRow] as never)
        .mockResolvedValueOnce([{ total: BigInt(200) }] as never);

      const caller = auditIntegrityRouter.createCaller(makeCtx({ prisma, ...SUPER_ADMIN_CTX_OVERRIDES }));
      const result = await caller.verifyChain({ fromId: 0 });

      expect(result.ok).toBe(false);
      expect(result.breaks).toHaveLength(1);
      expect(result.breaks[0]).toMatchObject({
        id: "42",
        expectedHash: "aaaa",
        actualHash: "bbbb",
      });
    });

    it("serializa broken_id BigInt como string", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { broken_id: BigInt(9999), expected_hash: "x", actual_hash: null },
        ] as never)
        .mockResolvedValueOnce([{ total: BigInt(1) }] as never);

      const caller = auditIntegrityRouter.createCaller(makeCtx({ prisma, ...SUPER_ADMIN_CTX_OVERRIDES }));
      const result = await caller.verifyChain({});

      expect(typeof result.breaks[0].id).toBe("string");
      expect(result.breaks[0].id).toBe("9999");
    });
  });

  // ------------------------------------------------------------------ chainStats
  describe("chainStats", () => {
    it("retorna estadisticas con BigInt convertido a number/string", async () => {
      prisma.$queryRaw.mockResolvedValue([
        { total_rows: BigInt(500), last_id: BigInt(500), last_hash: "deadbeef" },
      ] as never);

      const caller = auditIntegrityRouter.createCaller(makeCtx({ prisma, ...SUPER_ADMIN_CTX_OVERRIDES }));
      const result = await caller.chainStats();

      expect(result.totalRows).toBe(500);
      expect(result.lastId).toBe("500");
      expect(result.lastHash).toBe("deadbeef");
    });

    it("retorna null para lastId y lastHash cuando la tabla esta vacia", async () => {
      prisma.$queryRaw.mockResolvedValue([
        { total_rows: BigInt(0), last_id: null, last_hash: null },
      ] as never);

      const caller = auditIntegrityRouter.createCaller(makeCtx({ prisma, ...SUPER_ADMIN_CTX_OVERRIDES }));
      const result = await caller.chainStats();

      expect(result.totalRows).toBe(0);
      expect(result.lastId).toBeNull();
      expect(result.lastHash).toBeNull();
    });
  });
});
