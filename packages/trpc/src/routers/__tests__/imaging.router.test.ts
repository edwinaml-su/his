/**
 * Tests del imagingRouter (§18 RIS/PACS — Beta.9 hardening layer 1).
 *
 * Cubre:
 *  - tenant-isolation
 *  - state machine enforcement (VALID_STATUS_TRANSITIONS)
 *  - DICOM dicomCode field on modality.create
 *  - radiation dose fields on updateStatus
 *  - getOverdueOrders SLA detection
 *  - report.validate endpoint + immutability guard
 *  - report.create blocks validated reports
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { imagingRouter } from "../imaging.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";

describe("imagingRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ---------------------------------------------------------------------------
  // modality.list / create
  // ---------------------------------------------------------------------------

  describe("modality.list / create", () => {
    it("list filtra por establishment.organizationId y modalityType", async () => {
      prisma.imagingModality.findMany.mockResolvedValue([] as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.modality.list({
        modalityType: "CT",
        activeOnly: true,
        limit: 10,
      });
      const args = prisma.imagingModality.findMany.mock.calls[0]![0];
      expect(args!.where!.establishment).toBeTruthy();
      expect(args!.take).toBe(10);
    });

    it("create NOT_FOUND si establishment no pertenece al tenant", async () => {
      prisma.establishment.findFirst.mockResolvedValue(null as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.modality.create({
          establishmentId: u,
          code: "CT-01",
          name: "Tomógrafo",
          modalityType: "CT",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK con dicomCode", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingModality.create.mockResolvedValue({ id: u } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.modality.create({
        establishmentId: u,
        code: "CT-01",
        name: "Tomógrafo Principal",
        modalityType: "CT",
        dicomCode: "CT",
        aeTitle: "CT01_HOSP",
      });
      const args = prisma.imagingModality.create.mock.calls[0]![0];
      expect((args.data as { dicomCode: string }).dicomCode).toBe("CT");
      expect(args.data.aeTitle).toBe("CT01_HOSP");
    });

    it("create sin dicomCode pasa null", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingModality.create.mockResolvedValue({ id: u } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.modality.create({
        establishmentId: u,
        code: "MR-01",
        name: "MRI 1.5T",
        modalityType: "MR",
      });
      const args = prisma.imagingModality.create.mock.calls[0]![0];
      expect((args.data as { dicomCode: null }).dicomCode).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // order.list / get
  // ---------------------------------------------------------------------------

  describe("order.list / get", () => {
    it("list aplica filtros opcionales", async () => {
      prisma.imagingOrder.findMany.mockResolvedValue([] as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.order.list({
        status: "ORDERED",
        priority: "STAT",
        modalityType: "CT",
        limit: 5,
      });
      const args = prisma.imagingOrder.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBeTruthy();
      expect(args!.take).toBe(5);
    });

    it("get NOT_FOUND si no existe", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue(null as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // order.create
  // ---------------------------------------------------------------------------

  describe("order.create", () => {
    it("BAD_REQUEST si patientId no coincide", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: v } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          modalityType: "CR",
          studyDescription: "Rx",
          clinicalIndication: "Tos",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("inyecta orderingProviderId desde contexto", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.imagingOrder.create.mockResolvedValue({ id: u } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.order.create({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        modalityType: "CT",
        studyDescription: "TC cráneo",
        clinicalIndication: "TCE",
        priority: "STAT",
      });
      const args = prisma.imagingOrder.create.mock.calls[0]![0];
      expect(args.data.orderingProviderId).toBeTruthy();
      expect((args.data as { priority: string }).priority).toBe("STAT");
    });
  });

  // ---------------------------------------------------------------------------
  // order.updateStatus — state machine enforcement
  // ---------------------------------------------------------------------------

  describe("order.updateStatus — state machine", () => {
    it("ORDERED → SCHEDULED: transición válida OK", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u, status: "ORDERED" } as never);
      prisma.imagingOrder.update.mockResolvedValue({ id: u } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.order.updateStatus({ id: u, status: "SCHEDULED" });
      expect(r.ok).toBe(true);
    });

    it("IN_PROGRESS → COMPLETED: setea completedAt", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u, status: "IN_PROGRESS" } as never);
      prisma.imagingOrder.update.mockResolvedValue({ id: u } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.order.updateStatus({ id: u, status: "COMPLETED" });
      const args = prisma.imagingOrder.update.mock.calls[0]![0];
      expect((args.data as { completedAt: Date }).completedAt).toBeInstanceOf(Date);
    });

    it("COMPLETED → REPORTED: transición válida OK", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u, status: "COMPLETED" } as never);
      prisma.imagingOrder.update.mockResolvedValue({ id: u } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.order.updateStatus({ id: u, status: "REPORTED" });
      expect(r.ok).toBe(true);
    });

    it("ORDERED → COMPLETED: BAD_REQUEST (transición inválida)", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u, status: "ORDERED" } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.updateStatus({ id: u, status: "COMPLETED" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("VALIDATED → REPORTED: BAD_REQUEST (terminal)", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u, status: "VALIDATED" } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.updateStatus({ id: u, status: "REPORTED" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("NOT_FOUND si order no existe", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue(null as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.updateStatus({ id: u, status: "SCHEDULED" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("graba radiationDoseDap y radiationDoseCtdi cuando se proveen", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u, status: "IN_PROGRESS" } as never);
      prisma.imagingOrder.update.mockResolvedValue({ id: u } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.order.updateStatus({
        id: u,
        status: "COMPLETED",
        radiationDoseDap: 300,
        radiationDoseCtdi: 15.5,
      });
      const args = prisma.imagingOrder.update.mock.calls[0]![0];
      expect((args.data as { radiationDoseDap: number }).radiationDoseDap).toBe(300);
      expect((args.data as { radiationDoseCtdi: number }).radiationDoseCtdi).toBe(15.5);
    });
  });

  // ---------------------------------------------------------------------------
  // order.cancel
  // ---------------------------------------------------------------------------

  describe("order.cancel", () => {
    it("cancela orden ORDERED o SCHEDULED exitosamente", async () => {
      prisma.imagingOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.order.cancel({ id: u, reason: "Paciente desistió" });
      expect(r.ok).toBe(true);
      const args = prisma.imagingOrder.updateMany.mock.calls[0]![0];
      expect(args.where!.status).toEqual({ in: ["ORDERED", "SCHEDULED", "IN_PROGRESS"] });
    });

    it("NOT_FOUND si ya completada o no existe (count===0)", async () => {
      prisma.imagingOrder.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.cancel({ id: u, reason: "Paciente desistió" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ---------------------------------------------------------------------------
  // order.getOverdueOrders — SLA breach
  // ---------------------------------------------------------------------------

  describe("order.getOverdueOrders", () => {
    it("filtra por status notIn terminal states", async () => {
      prisma.imagingOrder.findMany.mockResolvedValue([] as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.order.getOverdueOrders({ limit: 10 });
      const args = prisma.imagingOrder.findMany.mock.calls[0]![0];
      expect(args!.where!.status).toMatchObject({ notIn: ["REPORTED", "VALIDATED", "CANCELLED"] });
    });

    it("retorna órdenes vencidas (orderedAt + sla < now)", async () => {
      const overdueTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
      const statOrder = {
        id: u,
        priority: "STAT",
        orderedAt: overdueTime, // STAT SLA = 60min → overdue after 1h
        status: "ORDERED",
      };
      const freshOrder = {
        id: v,
        priority: "ROUTINE",
        orderedAt: new Date(), // ROUTINE SLA = 1440min → not overdue
        status: "ORDERED",
      };
      prisma.imagingOrder.findMany.mockResolvedValue([statOrder, freshOrder] as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.order.getOverdueOrders({ limit: 50 });
      // Only the STAT order should be overdue
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(u);
    });

    it("filtra por establishmentId cuando se provee", async () => {
      prisma.imagingOrder.findMany.mockResolvedValue([] as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.order.getOverdueOrders({ establishmentId: u, limit: 10 });
      const args = prisma.imagingOrder.findMany.mock.calls[0]![0];
      expect(args!.where!.establishmentId).toBe(u);
    });
  });

  // ---------------------------------------------------------------------------
  // report.create / sign / validate
  // ---------------------------------------------------------------------------

  describe("report.create", () => {
    it("FORBIDDEN si el reporte ya fue validado", async () => {
      prisma.imagingReport.findUnique.mockResolvedValue({
        validatedAt: new Date(),
      } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.report.create({ orderId: u, findings: "x", impression: "y" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("NOT_FOUND si orden no está en COMPLETED/REPORTED", async () => {
      prisma.imagingReport.findUnique.mockResolvedValue(null as never);
      prisma.imagingOrder.findFirst.mockResolvedValue(null as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.report.create({ orderId: u, findings: "x", impression: "y" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea reporte y promueve orden COMPLETED → REPORTED", async () => {
      prisma.imagingReport.findUnique.mockResolvedValue(null as never);
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingReport.upsert.mockResolvedValue({ id: u } as never);
      prisma.imagingOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.report.create({
        orderId: u,
        findings: "Sin lesiones",
        impression: "Estudio normal",
      });
      const upsertArgs = prisma.imagingReport.upsert.mock.calls[0]![0];
      expect(upsertArgs.create.findings).toBe("Sin lesiones");
      // Should promote order to REPORTED
      expect(prisma.imagingOrder.updateMany).toHaveBeenCalled();
      const updateArgs = prisma.imagingOrder.updateMany.mock.calls[0]![0];
      expect((updateArgs.data as { status: string }).status).toBe("REPORTED");
    });
  });

  describe("report.sign", () => {
    it("actualiza signedAt", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingReport.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.report.sign({ orderId: u });
      expect(r.ok).toBe(true);
    });

    it("NOT_FOUND si report ya firmado (count===0)", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingReport.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.report.sign({ orderId: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("report.validate", () => {
    it("NOT_FOUND si orden no está en REPORTED", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue(null as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.report.validate({ orderId: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("PRECONDITION_FAILED si reporte no firmado o ya validado (count===0)", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingReport.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.report.validate({ orderId: u })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("valida reporte y promueve orden a VALIDATED", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingReport.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.imagingOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.report.validate({ orderId: u });
      expect(r.ok).toBe(true);
      // Verify validatedAt was set on report
      const reportArgs = prisma.imagingReport.updateMany.mock.calls[0]![0];
      expect((reportArgs.data as { validatedAt: Date }).validatedAt).toBeInstanceOf(Date);
      // Verify order promoted to VALIDATED
      const orderArgs = prisma.imagingOrder.updateMany.mock.calls[0]![0];
      expect((orderArgs.data as { status: string }).status).toBe("VALIDATED");
    });
  });
});
