/**
 * Tests del respiratoryRouter (§21 — Wave 8 Phase 2 skeleton).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { respiratoryRouter } from "../respiratory.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";

describe("respiratoryRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("order.create", () => {
    it("NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          prescriberId: u,
          type: "OXYGEN_THERAPY",
          flowRate: 3,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si patientId no coincide", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: v,
      } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          prescriberId: u,
          type: "AEROSOL",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("OK crea orden", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u,
        patientId: u,
      } as never);
      prisma.respiratoryOrder.create.mockResolvedValue({ id: u } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        type: "MECHANICAL_VENT",
        fio2: 40,
      });
      expect(r.id).toBe(u);
    });
  });

  describe("order.list / get / complete / cancel", () => {
    it("list filtra por organizationId", async () => {
      prisma.respiratoryOrder.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.list({ limit: 50 });
      const where = prisma.respiratoryOrder.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
      };
      expect(where.organizationId).toBeTruthy();
    });

    it("get NOT_FOUND", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("complete NOT_FOUND si ya cerrada", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.complete({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("complete OK setea endedAt", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.complete({ id: u });
      const data = prisma.respiratoryOrder.updateMany.mock.calls[0]![0]!.data as {
        status: string;
        endedAt: Date;
      };
      expect(data.status).toBe("COMPLETED");
      expect(data.endedAt).toBeInstanceOf(Date);
    });

    it("cancel OK setea CANCELLED", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.cancel({ id: u });
      const data = prisma.respiratoryOrder.updateMany.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(data.status).toBe("CANCELLED");
    });
  });

  describe("ventilator.create / end / list", () => {
    it("create NOT_FOUND si orden no es MECHANICAL_VENT activa", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({
          orderId: u,
          mode: "AC",
          tidalVolume: 450,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.ventilatorSession.create.mockResolvedValue({ id: u } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.create({
        orderId: u,
        mode: "SIMV",
        rrSet: 14,
        peep: 5,
        fio2: 35,
      });
      expect(r.id).toBe(u);
    });

    it("end NOT_FOUND si ya finalizada", async () => {
      prisma.ventilatorSession.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.ventilator.end({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("end OK setea endedAt", async () => {
      prisma.ventilatorSession.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.end({ id: u });
      expect(r.ok).toBe(true);
    });

    it("list filtra por order.organizationId", async () => {
      prisma.ventilatorSession.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.ventilator.list({ limit: 50 });
      const where = prisma.ventilatorSession.findMany.mock.calls[0]![0]!.where as {
        order: { organizationId: string };
      };
      expect(where.order.organizationId).toBeTruthy();
    });
  });

  describe("gas.create / list", () => {
    it("create NOT_FOUND si orden no es del tenant", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.gas.create({ orderId: u, gasType: "O2", volumeLiters: 100 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK setea recordedById", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.medicalGasUsage.create.mockResolvedValue({ id: u } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.gas.create({
        orderId: u,
        gasType: "O2",
        volumeLiters: 250.5,
      });
      const data = prisma.medicalGasUsage.create.mock.calls[0]![0]!.data as {
        gasType: string;
        recordedById: string;
      };
      expect(data.gasType).toBe("O2");
      expect(data.recordedById).toBeTruthy();
    });

    it("list filtra por gasType y fechas", async () => {
      prisma.medicalGasUsage.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.gas.list({
        gasType: "O2",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
        limit: 100,
      });
      const where = prisma.medicalGasUsage.findMany.mock.calls[0]![0]!.where as {
        gasType: string;
        measuredAt: { gte: Date; lte: Date };
      };
      expect(where.gasType).toBe("O2");
      expect(where.measuredAt.gte).toBeInstanceOf(Date);
    });
  });
});
