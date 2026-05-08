/**
 * Tests del triageDashboard router (US-6.5 / US-6.6).
 *
 * Cubre:
 *  - queueWithTimers asigna severity NORMAL / WARNING / CRITICAL según ratio
 *    elapsed/maxWaitMinutes.
 *  - counts agrupa por color de TriageLevel y respeta orden por priority.
 *  - filtros respetan organizationId del tenant.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { triageDashboardRouter } from "../triage-dashboard.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

describe("triageDashboardRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("queueWithTimers", () => {
    /** Construye una evaluación mock con elapsedMinutes controlado. */
    function makeEval(args: {
      id: string;
      startedAtOffsetMin: number;
      maxWaitMinutes: number;
      color: string;
      priority: number;
    }) {
      return {
        id: args.id,
        startedAt: new Date(Date.now() - args.startedAtOffsetMin * 60_000),
        encounterId: null,
        status: "IN_PROGRESS",
        organizationId: MOCK_TENANT.organizationId,
        patient: {
          id: "p-" + args.id,
          firstName: "Juan",
          lastName: "Pérez",
          mrn: "MRN1",
          birthDate: new Date("1990-01-01T00:00:00Z"),
          isUnknown: false,
        },
        serviceUnit: null,
        assignedLevel: {
          id: "lvl-" + args.color,
          color: args.color,
          name: args.color,
          priority: args.priority,
          maxWaitMinutes: args.maxWaitMinutes,
          uiColorHex: null,
        },
        reTriageOf_back: [],
      };
    }

    it("asigna severity NORMAL/WARNING/CRITICAL según elapsed vs maxWait", async () => {
      // 3 evaluaciones: 2min/30 NORMAL (~6.7%), 25min/30 WARNING (83%), 60min/30 CRITICAL (>100%).
      prisma.triageEvaluation.findMany.mockResolvedValue([
        makeEval({ id: "e-norm", startedAtOffsetMin: 2, maxWaitMinutes: 30, color: "GREEN", priority: 4 }),
        makeEval({ id: "e-warn", startedAtOffsetMin: 25, maxWaitMinutes: 30, color: "YELLOW", priority: 3 }),
        makeEval({ id: "e-crit", startedAtOffsetMin: 60, maxWaitMinutes: 30, color: "ORANGE", priority: 2 }),
      ] as never);
      prisma.triageLevel.findMany.mockResolvedValue([] as never);

      const caller = triageDashboardRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.queueWithTimers();

      const byId = Object.fromEntries(out.items.map((i) => [i.id, i]));
      expect(byId["e-norm"]!.severity).toBe("NORMAL");
      expect(byId["e-warn"]!.severity).toBe("WARNING");
      expect(byId["e-crit"]!.severity).toBe("CRITICAL");
      expect(byId["e-crit"]!.isOverdue).toBe(true);
    });

    it("counts agrupa por color usando triageLevel.findMany del tenant", async () => {
      prisma.triageEvaluation.findMany.mockResolvedValue([] as never);
      prisma.triageLevel.findMany.mockResolvedValue([
        { color: "RED", name: "Rojo", uiColorHex: "#f00" },
        { color: "GREEN", name: "Verde", uiColorHex: "#0f0" },
      ] as never);

      const caller = triageDashboardRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.queueWithTimers();

      // Verifica que la query se haga sobre el tenant.
      const args = prisma.triageLevel.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        active: true,
      });
      expect(out.counts.length).toBe(2);
      expect(out.counts.map((c) => c.color)).toEqual(["RED", "GREEN"]);
    });

    it("filtra triageEvaluation.findMany por organizationId del tenant", async () => {
      prisma.triageEvaluation.findMany.mockResolvedValue([] as never);
      prisma.triageLevel.findMany.mockResolvedValue([] as never);

      const caller = triageDashboardRouter.createCaller(makeCtx({ prisma }));
      await caller.queueWithTimers();

      const args = prisma.triageEvaluation.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
      });
      // Excluye COMPLETED y CANCELLED.
      expect(args.where.status).toEqual({
        notIn: ["COMPLETED", "CANCELLED"],
      });
    });
  });
});
