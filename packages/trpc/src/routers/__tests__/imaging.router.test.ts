/**
 * Tests del imagingRouter (§18 RIS/PACS — Wave 7 Phase 2 skeleton).
 *
 * Cubre tenant-isolation, workflow ORDERED → ACQUIRED → REPORTED,
 * cancelación condicional al status, y upsert de report.
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

    it("create OK", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingModality.create.mockResolvedValue({ id: u } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.modality.create({
        establishmentId: u,
        code: "MR-01",
        name: "MRI 1.5T",
        modalityType: "MR",
        aeTitle: "MR01_HOSP",
      });
      const args = prisma.imagingModality.create.mock.calls[0]![0];
      expect(args.data.aeTitle).toBe("MR01_HOSP");
    });
  });

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

  describe("order.updateStatus / cancel", () => {
    it("updateStatus ACQUIRED setea acquiredAt", async () => {
      prisma.imagingOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.order.updateStatus({ id: u, status: "ACQUIRED" });
      const args = prisma.imagingOrder.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("ACQUIRED");
      expect((args.data as { acquiredAt: Date }).acquiredAt).toBeInstanceOf(Date);
    });

    it("updateStatus NOT_FOUND si count===0", async () => {
      prisma.imagingOrder.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.updateStatus({ id: u, status: "REPORTED" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("cancel NOT_FOUND si ya adquirido (count===0)", async () => {
      prisma.imagingOrder.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.cancel({ id: u, reason: "Paciente desistió" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("report.create / sign", () => {
    it("create NOT_FOUND si orden no está en ACQUIRED/REPORTED", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue(null as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.report.create({
          orderId: u,
          findings: "x",
          impression: "y",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create hace upsert correctamente", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingReport.upsert.mockResolvedValue({ id: u } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await caller.report.create({
        orderId: u,
        findings: "Sin lesiones",
        impression: "Estudio normal",
      });
      const args = prisma.imagingReport.upsert.mock.calls[0]![0];
      expect(args.create.findings).toBe("Sin lesiones");
      expect(args.update.amendedAt).toBeInstanceOf(Date);
    });

    it("sign actualiza signedAt y promueve orden a REPORTED", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingReport.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.imagingOrder.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.report.sign({ orderId: u });
      expect(r.ok).toBe(true);
      expect(prisma.imagingOrder.updateMany).toHaveBeenCalled();
    });

    it("sign NOT_FOUND si report ya firmado (count===0 en report)", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u } as never);
      prisma.imagingReport.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = imagingRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.report.sign({ orderId: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
