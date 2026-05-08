/**
 * Tests del census router (US-5.4).
 *
 * Cubre:
 *  - bedMap filtra por organizationId del tenant.
 *  - occupancyStats agrega counts por status correctamente.
 *  - dailyMovements respeta el rango [start, end) del día solicitado.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { censusRouter } from "../census.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

describe("censusRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("bedMap", () => {
    it("filtra serviceUnit.findMany por organizationId del tenant", async () => {
      prisma.serviceUnit.findMany.mockResolvedValue([] as never);

      const caller = censusRouter.createCaller(makeCtx({ prisma }));
      await caller.bedMap();

      const args = prisma.serviceUnit.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        active: true,
      });
    });
  });

  describe("occupancyStats", () => {
    it("agrega counts por status y computa occupancyPct", async () => {
      // groupBy global por status: 4 OCCUPIED, 6 FREE, 1 BLOCKED.
      prisma.bed.groupBy.mockImplementation(((args: { by: string[] }) => {
        if (args.by.length === 1) {
          return Promise.resolve([
            { status: "OCCUPIED", _count: { _all: 4 } },
            { status: "FREE", _count: { _all: 6 } },
            { status: "BLOCKED", _count: { _all: 1 } },
          ]);
        }
        // byService — sin pivote para este test.
        return Promise.resolve([]);
      }) as never);
      prisma.serviceUnit.findMany.mockResolvedValue([] as never);

      const caller = censusRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.occupancyStats();

      // total = 11; operational = total - BLOCKED = 10; pct = 4/10 = 40.
      expect(out.global.total).toBe(11);
      expect(out.global.operational).toBe(10);
      expect(out.global.occupied).toBe(4);
      expect(out.global.occupancyPct).toBeCloseTo(40);
    });
  });

  describe("dailyMovements", () => {
    it("aplica filtro por ventana del día sobre admittedAt y dischargedAt", async () => {
      prisma.encounter.findMany.mockResolvedValue([] as never);
      prisma.encounterTransfer.findMany.mockResolvedValue([] as never);

      const date = new Date("2026-05-03T10:00:00Z");
      const caller = censusRouter.createCaller(makeCtx({ prisma }));
      await caller.dailyMovements({ date });

      // Primer call (admissions) — espera admittedAt: { gte: start, lt: end }.
      const admissionsArgs = prisma.encounter.findMany.mock.calls[0]![0];
      const range = admissionsArgs.where.admittedAt as { gte: Date; lt: Date };
      expect(range.gte).toBeInstanceOf(Date);
      expect(range.lt).toBeInstanceOf(Date);
      // [start, end) son 24h exactas.
      expect(range.lt.getTime() - range.gte.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });
});
