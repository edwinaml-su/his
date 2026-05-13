/**
 * Tests del nutritionRouter (§22 — Wave 8 Phase 2 skeleton).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { nutritionRouter } from "../nutrition.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";

describe("nutritionRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("diet.create / discontinue / list", () => {
    it("create NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.diet.create({
          encounterId: u,
          patientId: u,
          dietType: "DIABETIC",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create BAD_REQUEST si patientId no coincide", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: v,
      } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.diet.create({
          encounterId: u,
          patientId: u,
          dietType: "REGULAR",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create OK", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: u,
      } as never);
      prisma.dietPlan.create.mockResolvedValue({ id: u } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.diet.create({
        encounterId: u,
        patientId: u,
        dietType: "DIABETIC",
        caloriesTarget: 1800,
        proteinTarget: 80,
      });
      const data = prisma.dietPlan.create.mock.calls[0]![0]!.data as {
        organizationId: string;
        createdBy: string;
      };
      expect(data.organizationId).toBeTruthy();
      expect(data.createdBy).toBeTruthy();
    });

    it("discontinue NOT_FOUND si ya cerrado", async () => {
      prisma.dietPlan.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.diet.discontinue({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("discontinue OK setea DISCONTINUED + endedAt", async () => {
      prisma.dietPlan.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.diet.discontinue({ id: u });
      const data = prisma.dietPlan.updateMany.mock.calls[0]![0]!.data as {
        status: string;
        endedAt: Date;
      };
      expect(data.status).toBe("DISCONTINUED");
      expect(data.endedAt).toBeInstanceOf(Date);
    });

    it("list filtra por organizationId", async () => {
      prisma.dietPlan.findMany.mockResolvedValue([] as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.diet.list({ limit: 30 });
      const where = prisma.dietPlan.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
      };
      expect(where.organizationId).toBeTruthy();
    });
  });

  describe("assessment.create / list / get", () => {
    it("create OK con BMI calculado fuera del router", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: u,
      } as never);
      prisma.nutritionAssessment.create.mockResolvedValue({ id: u } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.assessment.create({
        encounterId: u,
        patientId: u,
        assessedById: u,
        weightKg: 70,
        heightCm: 170,
        bmi: 24.2,
        malnutritionRisk: "LOW",
      });
      const data = prisma.nutritionAssessment.create.mock.calls[0]![0]!.data as {
        malnutritionRisk: string;
      };
      expect(data.malnutritionRisk).toBe("LOW");
    });

    it("list filtra por malnutritionRisk", async () => {
      prisma.nutritionAssessment.findMany.mockResolvedValue([] as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.assessment.list({ malnutritionRisk: "HIGH", limit: 50 });
      const where = prisma.nutritionAssessment.findMany.mock.calls[0]![0]!.where as {
        malnutritionRisk: string;
      };
      expect(where.malnutritionRisk).toBe("HIGH");
    });

    it("get NOT_FOUND", async () => {
      prisma.nutritionAssessment.findFirst.mockResolvedValue(null as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.assessment.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("order.create / complete / cancel / list", () => {
    it("create NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          prescriberId: u,
          route: "ENTERAL",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create BAD_REQUEST si patientId no coincide", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: v,
      } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          prescriberId: u,
          route: "PARENTERAL",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create OK ENTERAL", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: u,
      } as never);
      prisma.nutritionOrder.create.mockResolvedValue({ id: u } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "ENTERAL",
        formula: "Ensure Plus",
        ratePerHour: 60,
      });
      const data = prisma.nutritionOrder.create.mock.calls[0]![0]!.data as {
        route: string;
      };
      expect(data.route).toBe("ENTERAL");
    });

    it("complete NOT_FOUND si ya cerrada", async () => {
      prisma.nutritionOrder.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.complete({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("complete OK", async () => {
      prisma.nutritionOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.order.complete({ id: u });
      expect(r.ok).toBe(true);
    });

    it("cancel OK setea CANCELLED + endedAt", async () => {
      prisma.nutritionOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.order.cancel({ id: u });
      const data = prisma.nutritionOrder.updateMany.mock.calls[0]![0]!.data as {
        status: string;
        endedAt: Date;
      };
      expect(data.status).toBe("CANCELLED");
      expect(data.endedAt).toBeInstanceOf(Date);
    });

    it("list filtra por route y status", async () => {
      prisma.nutritionOrder.findMany.mockResolvedValue([] as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.order.list({ route: "PARENTERAL", status: "ACTIVE", limit: 50 });
      const where = prisma.nutritionOrder.findMany.mock.calls[0]![0]!.where as {
        route: string;
        status: string;
      };
      expect(where.route).toBe("PARENTERAL");
      expect(where.status).toBe("ACTIVE");
    });
  });
});
