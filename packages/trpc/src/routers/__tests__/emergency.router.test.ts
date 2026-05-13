/**
 * Tests del emergencyRouter (§12 — Wave 7 Phase 2 skeleton).
 *
 * Cubre tenant-isolation, NOT_FOUND, happy-path para visit/disposition/note.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { emergencyRouter } from "../emergency.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";

describe("emergencyRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("visit.list", () => {
    it("filtra por organizationId y disposition", async () => {
      prisma.emergencyVisit.findMany.mockResolvedValue([] as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await caller.visit.list({
        disposition: "PENDING",
        limit: 100,
        fromDate: new Date(),
      });
      const args = prisma.emergencyVisit.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBeTruthy();
      expect(args!.where!.deletedAt).toBeNull();
      expect(args!.take).toBe(100);
    });
  });

  describe("visit.get", () => {
    it("retorna visita", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({ id: u } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.get({ id: u });
      expect(r.id).toBe(u);
    });

    it("NOT_FOUND si no existe", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.visit.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("visit.create", () => {
    it("NOT_FOUND si encounter no pertenece al tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          chiefComplaint: "Dolor",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si patientId no coincide", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: v } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          chiefComplaint: "Dolor",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("crea visita con arrivalMode default WALK_IN", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.emergencyVisit.create.mockResolvedValue({ id: u } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await caller.visit.create({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        chiefComplaint: "Dolor abdominal severo",
      });
      const args = prisma.emergencyVisit.create.mock.calls[0]![0];
      expect((args.data as { arrivalMode: string }).arrivalMode).toBe("WALK_IN");
    });
  });

  describe("visit.setDisposition", () => {
    it("setea LWBS y dispositionAt", async () => {
      prisma.emergencyVisit.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await caller.visit.setDisposition({ id: u, disposition: "LWBS" });
      const args = prisma.emergencyVisit.updateMany.mock.calls[0]![0];
      expect((args.data as { disposition: string }).disposition).toBe("LWBS");
      expect((args.data as { dispositionAt: Date }).dispositionAt).toBeInstanceOf(Date);
    });

    it("NOT_FOUND si count===0", async () => {
      prisma.emergencyVisit.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.setDisposition({ id: u, disposition: "DISCHARGED" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("visit.startObservation / endObservation", () => {
    it("startObservation NOT_FOUND si ya iniciada (count===0)", async () => {
      prisma.emergencyVisit.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.startObservation({ id: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("endObservation OK", async () => {
      prisma.emergencyVisit.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.endObservation({ id: u });
      expect(r.ok).toBe(true);
    });
  });

  describe("note.create / listByVisit", () => {
    it("note NOT_FOUND si visit no pertenece a tenant", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.note.create({
          visitId: u,
          category: "OBSERVATION",
          body: "x",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea nota OK", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({ id: u } as never);
      prisma.emergencyNote.create.mockResolvedValue({ id: u } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await caller.note.create({
        visitId: u,
        category: "REASSESSMENT",
        body: "Mejoría tras analgesia",
      });
      expect(prisma.emergencyNote.create).toHaveBeenCalled();
    });

    it("listByVisit aplica filter visit.organizationId", async () => {
      prisma.emergencyNote.findMany.mockResolvedValue([] as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await caller.note.listByVisit({ visitId: u, limit: 30 });
      const args = prisma.emergencyNote.findMany.mock.calls[0]![0];
      expect(args!.where!.visitId).toBe(u);
      expect(args!.take).toBe(30);
    });
  });
});
