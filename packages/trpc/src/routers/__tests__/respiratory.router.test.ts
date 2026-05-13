/**
 * Tests del respiratoryRouter (§21 — Wave 8 / Beta.12 hardening layer 1).
 *
 * Beta.12 coverage:
 *   - order.create sets expiresAt = now()+24h.
 *   - order.renew updates renewedAt + expiresAt.
 *   - order.getExpired returns orders past expiry.
 *   - ventilator.create rejects params outside safe ranges.
 *   - ventilator.transition enforces state-machine graph.
 *   - MedicalGasUsage: no update/delete mutations exposed.
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

  // -------------------------------------------------------------------------
  // order.create
  // -------------------------------------------------------------------------

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
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: v } as never);
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

    it("OK crea orden con expiresAt = now()+24h (Beta.12)", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.respiratoryOrder.create.mockResolvedValue({ id: u } as never);
      const before = Date.now();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        type: "MECHANICAL_VENT",
        fio2: 40,
      });
      expect(r.id).toBe(u);
      const data = prisma.respiratoryOrder.create.mock.calls[0]![0]!.data as {
        expiresAt: Date;
      };
      const delta = data.expiresAt.getTime() - before;
      expect(delta).toBeGreaterThan(23 * 3600 * 1000);
      expect(delta).toBeLessThan(25 * 3600 * 1000);
    });

    it("OK acepta expiresAt explícito (Beta.12)", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.respiratoryOrder.create.mockResolvedValue({ id: u } as never);
      const custom = new Date("2026-05-20T12:00:00Z");
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        type: "OXYGEN_THERAPY",
        expiresAt: custom,
      });
      const data = prisma.respiratoryOrder.create.mock.calls[0]![0]!.data as {
        expiresAt: Date;
      };
      expect(data.expiresAt).toEqual(custom);
    });
  });

  // -------------------------------------------------------------------------
  // order.list / get / complete / cancel
  // -------------------------------------------------------------------------

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

    it("complete OK setea status=COMPLETED + endedAt", async () => {
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

  // -------------------------------------------------------------------------
  // order.renew (Beta.12)
  // -------------------------------------------------------------------------

  describe("order.renew (Beta.12)", () => {
    it("renew NOT_FOUND si orden no activa", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.renew({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("renew OK setea renewedAt y expiresAt +24h", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const before = Date.now();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.order.renew({ id: u });
      expect(r.ok).toBe(true);
      const data = prisma.respiratoryOrder.updateMany.mock.calls[0]![0]!.data as {
        renewedAt: Date;
        expiresAt: Date;
      };
      expect(data.renewedAt).toBeInstanceOf(Date);
      expect(data.expiresAt).toBeInstanceOf(Date);
      const delta = data.expiresAt.getTime() - before;
      expect(delta).toBeGreaterThan(23 * 3600 * 1000);
      expect(delta).toBeLessThan(25 * 3600 * 1000);
    });

    it("renew filtra status=ACTIVE", async () => {
      prisma.respiratoryOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.renew({ id: u });
      const where = prisma.respiratoryOrder.updateMany.mock.calls[0]![0]!.where as {
        status: string;
      };
      expect(where.status).toBe("ACTIVE");
    });
  });

  // -------------------------------------------------------------------------
  // order.getExpired (Beta.12)
  // -------------------------------------------------------------------------

  describe("order.getExpired (Beta.12)", () => {
    it("retorna resultados con where correctos", async () => {
      prisma.respiratoryOrder.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const asOf = new Date("2026-05-13T10:00:00Z");
      await caller.order.getExpired({ asOf, limit: 10 });
      const where = prisma.respiratoryOrder.findMany.mock.calls[0]![0]!.where as {
        status: string;
        expiresAt: { lt: Date };
      };
      expect(where.status).toBe("ACTIVE");
      expect(where.expiresAt.lt).toEqual(asOf);
    });

    it("usa now() cuando asOf no se provee", async () => {
      prisma.respiratoryOrder.findMany.mockResolvedValue([] as never);
      const before = Date.now();
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.order.getExpired({ limit: 5 });
      const where = prisma.respiratoryOrder.findMany.mock.calls[0]![0]!.where as {
        expiresAt: { lt: Date };
      };
      expect(where.expiresAt.lt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // ventilator.create / end / list
  // -------------------------------------------------------------------------

  describe("ventilator.create / end / list", () => {
    it("create BAD_REQUEST si PEEP fuera de rango (Beta.12)", async () => {
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({ orderId: u, mode: "AC", peep: 25 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create BAD_REQUEST si FiO2 fuera de rango (Beta.12)", async () => {
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({ orderId: u, mode: "AC", fio2: 1.2 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create BAD_REQUEST si RR fuera de rango (Beta.12)", async () => {
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({ orderId: u, mode: "PSV", rrSet: 5 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create BAD_REQUEST si Vt fuera de rango (Beta.12)", async () => {
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({ orderId: u, mode: "AC", tidalVolume: 30 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create NOT_FOUND si orden no es MECHANICAL_VENT activa", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.create({ orderId: u, mode: "AC", tidalVolume: 450, peep: 8, fio2: 0.4, rrSet: 14 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK persiste params en rango", async () => {
      prisma.respiratoryOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.ventilatorSession.create.mockResolvedValue({ id: u } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.create({
        orderId: u,
        mode: "SIMV",
        rrSet: 14,
        peep: 8,
        fio2: 0.35,
        tidalVolume: 500,
        patientWeightKg: 70,
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

    it("list filtra por statusSM (Beta.12)", async () => {
      prisma.ventilatorSession.findMany.mockResolvedValue([] as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await caller.ventilator.list({ statusSM: "WEANING", limit: 10 });
      const where = prisma.ventilatorSession.findMany.mock.calls[0]![0]!.where as {
        statusSM: string;
      };
      expect(where.statusSM).toBe("WEANING");
    });
  });

  // -------------------------------------------------------------------------
  // ventilator.transition (Beta.12)
  // -------------------------------------------------------------------------

  describe("ventilator.transition (Beta.12)", () => {
    it("NOT_FOUND si sesión no existe", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue(null as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.transition({ id: u, to: "WEANING" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si sesión ya finalizada", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "ACTIVE",
        endedAt: new Date(),
      } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.transition({ id: u, to: "WEANING" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("BAD_REQUEST en transición ilegal ACTIVE→EXTUBATED", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "ACTIVE",
        endedAt: null,
      } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.transition({ id: u, to: "EXTUBATED" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("BAD_REQUEST en transición ilegal EXTUBATED→ACTIVE", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "EXTUBATED",
        endedAt: null,
      } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.ventilator.transition({ id: u, to: "ACTIVE" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("OK transición válida ACTIVE→WEANING", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "ACTIVE",
        endedAt: null,
      } as never);
      prisma.ventilatorSession.update.mockResolvedValue({ id: u, statusSM: "WEANING" } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.transition({ id: u, to: "WEANING" });
      expect((r as { statusSM: string }).statusSM).toBe("WEANING");
    });

    it("OK transición válida WEANING→ESCALATED", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "WEANING",
        endedAt: null,
      } as never);
      prisma.ventilatorSession.update.mockResolvedValue({ id: u, statusSM: "ESCALATED" } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.transition({ id: u, to: "ESCALATED" });
      expect((r as { statusSM: string }).statusSM).toBe("ESCALATED");
    });

    it("OK transición válida WEANING→FAILED_EXTUBATION", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "WEANING",
        endedAt: null,
      } as never);
      prisma.ventilatorSession.update.mockResolvedValue({
        id: u,
        statusSM: "FAILED_EXTUBATION",
      } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.transition({ id: u, to: "FAILED_EXTUBATION" });
      expect((r as { statusSM: string }).statusSM).toBe("FAILED_EXTUBATION");
    });

    it("OK transición válida ESCALATED→ACTIVE (deterioro)", async () => {
      prisma.ventilatorSession.findFirst.mockResolvedValue({
        id: u,
        statusSM: "ESCALATED",
        endedAt: null,
      } as never);
      prisma.ventilatorSession.update.mockResolvedValue({ id: u, statusSM: "ACTIVE" } as never);
      const caller = respiratoryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.ventilator.transition({ id: u, to: "ACTIVE" });
      expect((r as { statusSM: string }).statusSM).toBe("ACTIVE");
    });
  });

  // -------------------------------------------------------------------------
  // gas.create / list
  // -------------------------------------------------------------------------

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
