/**
 * Tests del lisRouter (§17 — Phase 2 skeleton).
 *
 * Cubre la regla 4-eyes (validator distinto del resultador).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { lisRouter } from "../lis.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN } from "@his/test-utils";

const u = "00000000-0000-0000-0000-000000000001";

describe("lisRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("panel.list", () => {
    it("incluye catálogo global y tenant en OR cuando no hay search", async () => {
      prisma.labPanel.findMany.mockResolvedValue([] as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await caller.panel.list({ activeOnly: true, limit: 10 });
      const args = prisma.labPanel.findMany.mock.calls[0]![0];
      const orClauses = (args!.where!.OR as Array<{ organizationId: unknown }>) ?? [];
      expect(orClauses).toEqual(
        expect.arrayContaining([{ organizationId: null }]),
      );
    });
  });

  describe("test.list", () => {
    it("filtra por panelId opcional", async () => {
      prisma.labTest.findMany.mockResolvedValue([] as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await caller.test.list({ panelId: u, activeOnly: true, limit: 50 });
      const args = prisma.labTest.findMany.mock.calls[0]![0];
      expect(args!.where!.panelId).toBe(u);
    });
  });

  describe("order.get", () => {
    it("NOT_FOUND si orden no existe en tenant", async () => {
      prisma.labOrder.findFirst.mockResolvedValue(null as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("order.create", () => {
    it("NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          items: [{ testId: u }],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si patientId difiere del encounter.patientId", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: "00000000-0000-0000-0000-000000000099",
      } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          items: [{ testId: u }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("crea orden con status=ORDERED y prioridad default ROUTINE", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: u,
      } as never);
      prisma.labOrder.create.mockResolvedValue({ id: u, items: [] } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await caller.order.create({
        encounterId: u,
        patientId: u,
        items: [{ testId: u }],
      });
      const args = prisma.labOrder.create.mock.calls[0]![0];
      expect(args.data.status).toBe("ORDERED");
      expect(args.data.priority).toBe("ROUTINE");
    });
  });

  describe("specimen.collect", () => {
    it("NOT_FOUND si orden no existe", async () => {
      prisma.labOrder.findFirst.mockResolvedValue(null as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.specimen.collect({ orderId: u, type: "BLOOD", barcode: "B1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea specimen con condition=ACCEPTABLE por default", async () => {
      prisma.labOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.labSpecimen.create.mockResolvedValue({ id: u } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await caller.specimen.collect({ orderId: u, type: "BLOOD", barcode: "B1" });
      const args = prisma.labSpecimen.create.mock.calls[0]![0];
      expect(args.data.condition).toBe("ACCEPTABLE");
      expect(args.data.collectedById).toBeTruthy();
    });
  });

  describe("specimen.reject", () => {
    it("NOT_FOUND si specimen no existe en orden del tenant", async () => {
      prisma.labSpecimen.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.specimen.reject({ id: u, rejectionReason: "Hemolizada" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("result.enter (Beta.3 auto-flag)", () => {
    it("NOT_FOUND si orderItem no es del tenant", async () => {
      prisma.labOrderItem.findFirst.mockResolvedValue(null as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.result.enter({
          orderItemId: u,
          valueNumeric: 7.2,
          flag: "NORMAL",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("guarda resultedById del usuario y respeta flag manual cuando no hay refs", async () => {
      prisma.labOrderItem.findFirst.mockResolvedValue({
        id: u,
        test: {
          code: "GLU",
          name: "Glucosa",
          refRangeLow: null,
          refRangeHigh: null,
          critical: false,
          unit: "mg/dL",
        },
      } as never);
      prisma.labResult.create.mockResolvedValue({ id: u } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.result.enter({
        orderItemId: u,
        valueNumeric: 7.2,
        flag: "NORMAL",
      });
      const args = prisma.labResult.create.mock.calls[0]![0];
      expect(args.data.resultedById).toBeTruthy();
      expect(r.finalFlag).toBe("NORMAL");
      expect(r.isCritical).toBe(false);
      expect(r.alerts).toEqual([]);
    });

    it("Beta.3 — calcula flag HIGH automáticamente desde refRange", async () => {
      prisma.labOrderItem.findFirst.mockResolvedValue({
        id: u,
        test: {
          code: "GLU",
          name: "Glucosa",
          refRangeLow: { toNumber: () => 70 },
          refRangeHigh: { toNumber: () => 100 },
          critical: false,
          unit: "mg/dL",
        },
      } as never);
      prisma.labResult.create.mockResolvedValue({ id: u } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.result.enter({
        orderItemId: u,
        valueNumeric: 130,
        flag: "NORMAL", // será sobreescrito por evaluateLabResultFlag
      });
      expect(r.finalFlag).toBe("HIGH");
      expect(r.isCritical).toBe(false);
    });

    it("Beta.3 — calcula CRITICAL_HIGH para test marcado critical con valor extremo", async () => {
      prisma.labOrderItem.findFirst.mockResolvedValue({
        id: u,
        test: {
          code: "GLU",
          name: "Glucosa",
          refRangeLow: { toNumber: () => 70 },
          refRangeHigh: { toNumber: () => 100 },
          critical: true, // habilita criticalLow/High en heurística
          unit: "mg/dL",
        },
      } as never);
      prisma.labResult.create.mockResolvedValue({ id: u } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      // criticalHigh heurística Wave 1: refRangeHigh + 50% = 100 + 50 = 150
      const r = await caller.result.enter({
        orderItemId: u,
        valueNumeric: 200,
        flag: "NORMAL",
      });
      expect(r.finalFlag).toBe("CRITICAL_HIGH");
      expect(r.isCritical).toBe(true);
      expect(r.alerts).toHaveLength(1);
      expect(r.alerts[0]!.testCode).toBe("GLU");
    });

    it("Beta.3 — forceFlagOverride=true respeta el flag manual sin recalcular", async () => {
      prisma.labOrderItem.findFirst.mockResolvedValue({
        id: u,
        test: {
          code: "GLU",
          name: "Glucosa",
          refRangeLow: { toNumber: () => 70 },
          refRangeHigh: { toNumber: () => 100 },
          critical: true,
          unit: "mg/dL",
        },
      } as never);
      prisma.labResult.create.mockResolvedValue({ id: u } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.result.enter({
        orderItemId: u,
        valueNumeric: 200, // sería CRITICAL_HIGH, pero forzamos NORMAL
        flag: "NORMAL",
        forceFlagOverride: true,
      });
      expect(r.finalFlag).toBe("NORMAL");
      expect(r.isCritical).toBe(false);
    });

    it("Beta.3 — NORMAL si valueNumeric null (cualitativo via valueText)", async () => {
      prisma.labOrderItem.findFirst.mockResolvedValue({
        id: u,
        test: {
          code: "QUAL",
          name: "Qualitativo",
          refRangeLow: null,
          refRangeHigh: null,
          critical: false,
          unit: null,
        },
      } as never);
      prisma.labResult.create.mockResolvedValue({ id: u } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.result.enter({
        orderItemId: u,
        valueText: "Positivo",
        flag: "ABNORMAL",
      });
      expect(r.finalFlag).toBe("ABNORMAL");
    });
  });

  describe("result.validate (4-eyes + Beta.3 history)", () => {
    it("FORBIDDEN si el validador es el mismo que el resultador", async () => {
      prisma.labResult.findFirst.mockResolvedValue({
        id: u,
        resultedById: MOCK_USER_ADMIN.id,
        notes: null,
        flag: "NORMAL",
      } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.result.validate({ resultId: u }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("NOT_FOUND si resultado ya validado", async () => {
      prisma.labResult.findFirst.mockResolvedValue(null as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.result.validate({ resultId: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("valida resultado si validador distinto del resultador", async () => {
      prisma.labResult.findFirst.mockResolvedValue({
        id: u,
        resultedById: "00000000-0000-0000-0000-000000000099",
        notes: null,
        flag: "HIGH",
      } as never);
      prisma.labResult.update.mockResolvedValue({ id: u } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await caller.result.validate({ resultId: u });
      const args = prisma.labResult.update.mock.calls[0]![0];
      expect(args.data.validatedById).toBeTruthy();
      expect(args.data.validatedAt).toBeInstanceOf(Date);
    });

    it("Beta.3 — appendea history line en notes", async () => {
      prisma.labResult.findFirst.mockResolvedValue({
        id: u,
        resultedById: "00000000-0000-0000-0000-000000000099",
        notes: "Nota previa del tecnólogo",
        flag: "CRITICAL_HIGH",
      } as never);
      prisma.labResult.update.mockResolvedValue({ id: u } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await caller.result.validate({ resultId: u });
      const args = prisma.labResult.update.mock.calls[0]![0];
      const newNotes = (args.data as { notes: string }).notes;
      expect(newNotes).toContain("Nota previa del tecnólogo");
      expect(newNotes).toContain("[VALIDATED by");
      expect(newNotes).toContain("flag=CRITICAL_HIGH");
    });

    it("Beta.3 — notes vacío genera la primera history line correctamente", async () => {
      prisma.labResult.findFirst.mockResolvedValue({
        id: u,
        resultedById: "00000000-0000-0000-0000-000000000099",
        notes: null,
        flag: "NORMAL",
      } as never);
      prisma.labResult.update.mockResolvedValue({ id: u } as never);
      const caller = lisRouter.createCaller(makeCtx({ prisma }));
      await caller.result.validate({ resultId: u });
      const args = prisma.labResult.update.mock.calls[0]![0];
      const newNotes = (args.data as { notes: string }).notes;
      expect(newNotes).toMatch(/^\[\d{4}/);
      expect(newNotes).toContain("[VALIDATED by");
    });
  });
});
