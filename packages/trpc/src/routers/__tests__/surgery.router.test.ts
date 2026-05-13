/**
 * Tests del surgeryRouter — Beta.6 hardening layer 1.
 *
 * Cubre:
 * - OR catalog (list/create con tenant-isolation)
 * - case.create con OR conflict detection
 * - WHO checklist gates: signIn → timeOut → start → signOut → postOp → complete
 * - state machine: cancel, postpone (con OR conflict)
 * - anesthesia tracking
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { surgeryRouter } from "../surgery.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";
const start = new Date(Date.now() + 86_400_000);
const end = new Date(Date.now() + 86_400_000 + 3 * 3_600_000);

describe("surgeryRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // --------------------------------------------------------------------------
  // operatingRoom.list / create
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // case.list / get
  // --------------------------------------------------------------------------
  describe("case.list / get", () => {
    it("list filtra por organizationId y status", async () => {
      prisma.surgeryCase.findMany.mockResolvedValue([] as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.list({ status: "SCHEDULED", limit: 30 });
      const args = prisma.surgeryCase.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBeTruthy();
      expect(args!.where!.deletedAt).toBeNull();
    });

    it("list acepta status POST_OP", async () => {
      prisma.surgeryCase.findMany.mockResolvedValue([] as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.list({ status: "POST_OP" });
      const args = prisma.surgeryCase.findMany.mock.calls[0]![0];
      expect((args!.where as { status: string }).status).toBe("POST_OP");
    });

    it("get NOT_FOUND si no existe", async () => {
      prisma.surgeryCase.findFirst.mockResolvedValue(null as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.case.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // --------------------------------------------------------------------------
  // case.create — incluyendo OR conflict detection
  // --------------------------------------------------------------------------
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

    it("CONFLICT si quirófano tiene solapamiento", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      // OR conflict found
      prisma.surgeryCase.findFirst.mockResolvedValue({ id: v } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.case.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          primarySurgeonId: u,
          operatingRoomId: v,
          procedureDescription: "Colecistectomía",
          scheduledStart: start,
          scheduledEnd: end,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("OK crea caso sin quirófano (sin conflict check)", async () => {
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
      // No conflict check called (no operatingRoomId)
      expect(prisma.surgeryCase.findFirst.mock.calls.length).toBe(0);
    });

    it("OK crea caso con quirófano libre", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      // No conflict
      prisma.surgeryCase.findFirst.mockResolvedValue(null as never);
      prisma.surgeryCase.create.mockResolvedValue({ id: u } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.create({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        primarySurgeonId: u,
        operatingRoomId: v,
        procedureDescription: "Hernioplastia",
        scheduledStart: start,
        scheduledEnd: end,
      });
      // Conflict detection query was made
      expect(prisma.surgeryCase.findFirst.mock.calls.length).toBe(1);
      const conflictArgs = prisma.surgeryCase.findFirst.mock.calls[0]![0];
      expect((conflictArgs!.where as { operatingRoomId: string }).operatingRoomId).toBe(v);
    });
  });

  // --------------------------------------------------------------------------
  // WHO checklist — signIn
  // --------------------------------------------------------------------------
  describe("case.signIn", () => {
    it("NOT_FOUND si caso no existe o ya tiene signIn", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.case.signIn({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK registra signInAt + signInById", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.case.signIn({ id: u });
      expect(r.ok).toBe(true);
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { signInAt: Date }).signInAt).toBeInstanceOf(Date);
      expect((args.data as { signInById: string }).signInById).toBeTruthy();
      // Idempotency guard: where must include signInAt: null
      expect((args.where as { signInAt: null }).signInAt).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // WHO checklist — timeOut (requires signIn first)
  // --------------------------------------------------------------------------
  describe("case.timeOut", () => {
    it("NOT_FOUND si falta signIn previo (count===0)", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.case.timeOut({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK registra timeOutAt + timeOutById y requiere signInAt not null", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.timeOut({ id: u });
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { timeOutAt: Date }).timeOutAt).toBeInstanceOf(Date);
      expect((args.data as { timeOutById: string }).timeOutById).toBeTruthy();
      // Must require signInAt not null
      const where = args.where as { signInAt: { not: null } };
      expect(where.signInAt).toEqual({ not: null });
    });
  });

  // --------------------------------------------------------------------------
  // case.start — requires signIn + timeOut
  // --------------------------------------------------------------------------
  describe("case.start", () => {
    it("NOT_FOUND si falta checklist (count===0)", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.case.start({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK transiciona a IN_PROGRESS y exige signIn+timeOut", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.start({ id: u });
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("IN_PROGRESS");
      expect((args.data as { actualStart: Date }).actualStart).toBeInstanceOf(Date);
      const where = args.where as { signInAt: { not: null }; timeOutAt: { not: null } };
      expect(where.signInAt).toEqual({ not: null });
      expect(where.timeOutAt).toEqual({ not: null });
    });
  });

  // --------------------------------------------------------------------------
  // WHO checklist — signOut
  // --------------------------------------------------------------------------
  describe("case.signOut", () => {
    it("NOT_FOUND si no está IN_PROGRESS o ya tiene signOut", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.case.signOut({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK registra signOutAt + signOutById", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.case.signOut({ id: u });
      expect(r.ok).toBe(true);
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { signOutAt: Date }).signOutAt).toBeInstanceOf(Date);
      expect((args.data as { signOutById: string }).signOutById).toBeTruthy();
      // Idempotency guard
      expect((args.where as { signOutAt: null }).signOutAt).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // case.postOp — IN_PROGRESS + signOut → POST_OP
  // --------------------------------------------------------------------------
  describe("case.postOp", () => {
    it("NOT_FOUND si falta signOut (count===0)", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.case.postOp({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK transiciona a POST_OP y registra actualEnd", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.postOp({ id: u, intraopNotes: "Sin complicaciones" });
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("POST_OP");
      expect((args.data as { actualEnd: Date }).actualEnd).toBeInstanceOf(Date);
      // Requires signOut
      const where = args.where as { signOutAt: { not: null } };
      expect(where.signOutAt).toEqual({ not: null });
    });
  });

  // --------------------------------------------------------------------------
  // case.complete — POST_OP → COMPLETED
  // --------------------------------------------------------------------------
  describe("case.complete", () => {
    it("NOT_FOUND si no está POST_OP (count===0)", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.case.complete({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK transiciona a COMPLETED desde POST_OP", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.complete({ id: u, postopNotes: "Estable" });
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("COMPLETED");
      expect((args.where as { status: string }).status).toBe("POST_OP");
    });
  });

  // --------------------------------------------------------------------------
  // case.cancel
  // --------------------------------------------------------------------------
  describe("case.cancel", () => {
    it("NOT_FOUND si ya inició o fue cancelado", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.case.cancel({ id: u, cancelReason: "Desistió" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("OK guarda cancelReason y status CANCELLED", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.cancel({ id: u, cancelReason: "Paciente desistió" });
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("CANCELLED");
      expect((args.data as { cancelReason: string }).cancelReason).toBe("Paciente desistió");
      // Allows cancellation from POSTPONED too
      const where = args.where as { status: { in: string[] } };
      expect(where.status.in).toContain("POSTPONED");
    });
  });

  // --------------------------------------------------------------------------
  // case.postpone
  // --------------------------------------------------------------------------
  describe("case.postpone", () => {
    const newStart = new Date(Date.now() + 2 * 86_400_000);
    const newEnd = new Date(Date.now() + 2 * 86_400_000 + 2 * 3_600_000);

    it("BAD_REQUEST si newEnd <= newStart", async () => {
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.case.postpone({
          id: u,
          cancelReason: "Agenda llena",
          newScheduledStart: newEnd,
          newScheduledEnd: newStart,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("NOT_FOUND si caso no existe o ya inició", async () => {
      prisma.surgeryCase.findFirst.mockResolvedValue(null as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.case.postpone({
          id: u,
          cancelReason: "Agenda llena",
          newScheduledStart: newStart,
          newScheduledEnd: newEnd,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("CONFLICT si nuevo horario solapa", async () => {
      prisma.surgeryCase.findFirst
        .mockResolvedValueOnce({ id: u, operatingRoomId: v } as never) // existing case
        .mockResolvedValueOnce({ id: v } as never); // conflict found
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.case.postpone({
          id: u,
          cancelReason: "Agenda llena",
          newScheduledStart: newStart,
          newScheduledEnd: newEnd,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("OK postpone sin quirófano (sin conflict check)", async () => {
      prisma.surgeryCase.findFirst.mockResolvedValueOnce({
        id: u,
        operatingRoomId: null,
      } as never);
      prisma.surgeryCase.update.mockResolvedValue({ id: u } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.postpone({
        id: u,
        cancelReason: "Sin cama disponible",
        newScheduledStart: newStart,
        newScheduledEnd: newEnd,
      });
      const args = prisma.surgeryCase.update.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("POSTPONED");
    });
  });

  // --------------------------------------------------------------------------
  // case.recordAnesthesia
  // --------------------------------------------------------------------------
  describe("case.recordAnesthesia", () => {
    it("NOT_FOUND si caso no existe o en estado terminal", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.case.recordAnesthesia({
          id: u,
          anesthesiaType: "GENERAL",
          anesthesiaStartAt: start,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("OK registra anesthesiaType y anesthesiaStartAt", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.case.recordAnesthesia({
        id: u,
        anesthesiaType: "REGIONAL",
        anesthesiaStartAt: start,
        anesthesiaEndAt: end,
      });
      expect(r.ok).toBe(true);
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      expect((args.data as { anesthesiaType: string }).anesthesiaType).toBe("REGIONAL");
      expect(
        (args.data as { anesthesiaStartAt: Date }).anesthesiaStartAt,
      ).toStrictEqual(start);
      expect(
        (args.data as { anesthesiaEndAt: Date }).anesthesiaEndAt,
      ).toStrictEqual(end);
    });

    it("OK sin anesthesiaEndAt (cirugía en progreso)", async () => {
      prisma.surgeryCase.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = surgeryRouter.createCaller(makeCtx({ prisma }));
      await caller.case.recordAnesthesia({
        id: u,
        anesthesiaType: "GENERAL",
        anesthesiaStartAt: start,
      });
      const args = prisma.surgeryCase.updateMany.mock.calls[0]![0];
      // anesthesiaEndAt should not be in data when not provided
      expect(
        (args.data as Record<string, unknown>)["anesthesiaEndAt"],
      ).toBeUndefined();
    });
  });
});
