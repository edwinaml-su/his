/**
 * Tests del triageFlowchart router (US-6.3 / US-6.4).
 *
 * Cubre:
 *  - list filtra por activeOnly default (incluye includeInactive=false → active=true).
 *  - get retorna NOT_FOUND si flowchart no existe en el tenant.
 *  - listForTriage devuelve flowchart + discriminadores activos ordenados ordinal asc.
 *  - setActive cambia el flag tras verificar pertenencia al tenant.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { triageFlowchartRouter } from "../triage-flowchart.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

function fn<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

describe("triageFlowchartRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("list", () => {
    it("filtra por active=true por default (includeInactive=false)", async () => {
      prisma.triageFlowchart.findMany.mockResolvedValue([] as never);

      const caller = triageFlowchartRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ includeInactive: false });

      const args = prisma.triageFlowchart.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        active: true,
      });
    });

    it("omite el filtro active cuando includeInactive=true", async () => {
      prisma.triageFlowchart.findMany.mockResolvedValue([] as never);

      const caller = triageFlowchartRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ includeInactive: true });

      const where = prisma.triageFlowchart.findMany.mock.calls[0]![0].where;
      expect(where).not.toHaveProperty("active");
    });
  });

  describe("get", () => {
    it("retorna NOT_FOUND si el flujograma no existe en el tenant", async () => {
      prisma.triageFlowchart.findFirst = fn(null) as never;

      const caller = triageFlowchartRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.get({ id: "00000000-0000-0000-0000-000000000099" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("listForTriage", () => {
    it("devuelve flowchart + discriminadores activos ordenados ordinal asc", async () => {
      prisma.triageEvaluation.findFirst = fn({
        id: "ev-1",
        flowchartId: "fc-1",
        status: "IN_PROGRESS",
      }) as never;
      prisma.triageFlowchart.findUnique = fn({
        id: "fc-1",
        code: "chest_pain",
        name: "Dolor torácico",
        isPediatric: false,
        defaultLevelId: null,
      }) as never;
      prisma.triageDiscriminator.findMany.mockResolvedValue([
        {
          id: "d1",
          code: "shock",
          text: "Shock",
          ordinal: 1,
          active: true,
          resultLevel: {
            id: "lvl-r",
            color: "RED",
            name: "Rojo",
            priority: 1,
            maxWaitMinutes: 0,
            uiColorHex: null,
          },
        },
      ] as never);

      const caller = triageFlowchartRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.listForTriage({
        triageEvaluationId: "00000000-0000-0000-0000-000000000010",
      });

      const args = prisma.triageDiscriminator.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({ flowchartId: "fc-1", active: true });
      expect(args.orderBy).toEqual({ ordinal: "asc" });
      expect(out.discriminators).toHaveLength(1);
    });

    it("retorna NOT_FOUND si la evaluación no pertenece al tenant", async () => {
      prisma.triageEvaluation.findFirst = fn(null) as never;

      const caller = triageFlowchartRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.listForTriage({
          triageEvaluationId: "00000000-0000-0000-0000-000000000099",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("setActive", () => {
    it("verifica pertenencia al tenant y cambia el flag", async () => {
      prisma.triageFlowchart.findFirst = fn({ id: "fc-1" }) as never;
      prisma.triageFlowchart.update.mockResolvedValue({
        id: "fc-1",
        active: false,
      } as never);

      const caller = triageFlowchartRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.setActive({
        id: "00000000-0000-0000-0000-000000000010",
        active: false,
      });

      expect(prisma.triageFlowchart.update.mock.calls[0]![0]).toMatchObject({
        where: { id: "fc-1" },
        data: { active: false },
      });
      expect(out.active).toBe(false);
    });
  });
});
