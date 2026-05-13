/**
 * Tests del surgeryRouter (§13 — Wave 7 Phase 2 skeleton).
 *
 * Cubre tenant-isolation por relación (OperatingRoom hangs off Establishment),
 * workflow time-out → start → complete, y cancelación.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { surgeryRouter } from "../surgery.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";
const start = new Date(Date.now() + 86_400_000);
const end = new Date(Date.now() + 86_400_000 + 3 * 3600_000);

describe("surgeryRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("operatingRoom.list / create", () => {
    it("list filtra por establishment.organizationId", async () => {
      prisma.operatingRoom.findMany.mockResolvedValue([] as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.operatingRoom.list({ activeOnly: true, limit: 20 });
      const args = prisma.operatingRoom.findMany.mock.calls[0]![0];
      expect(args!.where!.establishment).toBeTruthy();
      expect(args!.take).toBe(20);
    });

    it("create NOT_FOUND si establishment no pertenece al tenant", async () => {
      prisma.establishment.findFirst.mockResolvedValue(null as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.operatingRoom.create({
          establishmentId: u,
          code: "OR-01",
          name: "Q1",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK cuando establishment existe", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.operatingRoom.create.mockResolvedValue({ id: u } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.operatingRoom.create({
        establishmentId: u,
        code: "OR-02",
        name: "Q2",
      });
      expect(r.id).toBe(u);
    });
  });

  describe("case.list / get", () => {
    it("list filtra por organizationId y status", async () => {
      prisma.surgeryCase.findMany.mockResolvedValue([] as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.list({ status: "SCHEDULED", limit: 30 });
      const args = prisma.surgeryCase.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBeTruthy();
      expect(args!.where!.deletedAt).toBeNull();
    });

    it("get NOT_FOUND si no existe", async () => {
      prisma.surgeryCase.findFirst.mockResolvedValue(null as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.case.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("case.create", () => {
    it("BAD_REQUEST si patient no coincide", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: v } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.case.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          primarySurgeonId: u,
          procedureDescription: "Apendicectomía",
          scheduledStart: start,
          scheduledEnd: end,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("OK crea caso", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.surgeryCase.create.mockResolvedValue({ id: u } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.create({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        primarySurgeonId: u,
        procedureDescription: "Apendicectomía",
        scheduledStart: start,
        scheduledEnd: end,
        asaClass: "ASA_II",
      });
      const args = prisma.surgeryCase.create.mock.calls[0]![0];
      expect(args.data.organizationId).toBeTruthy();
      expect(args.data.createdBy).toBeTruthy();
    });
  });

  describe("case.timeOut / start / complete / cancel", () => {
    it("timeOut NOT_FOUND si status no válido", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.case.timeOut({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("timeOut OK setea timeOutAt + timeOutById", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.timeOut({ id: u });
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { timeOutAt: Date }).timeOutAt).toBeInstanceOf(Date);
      expect((args.data as { timeOutById: string }).timeOutById).toBeTruthy();
    });

    it("start NOT_FOUND si falta time-out (count===0)", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.case.start({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("complete OK setea actualEnd + notas", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.complete({
        id: u,
        intraopNotes: "Sin complicaciones",
        postopNotes: "Estable",
      });
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("COMPLETED");
      expect((args.data as { actualEnd: Date }).actualEnd).toBeInstanceOf(Date);
    });

    it("cancel guarda cancelReason", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.cancel({ id: u, cancelReason: "Paciente desistió" });
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("CANCELLED");
      expect((args.data as { cancelReason: string }).cancelReason).toBe(
        "Paciente desistió",
      );
    });
  });
});
