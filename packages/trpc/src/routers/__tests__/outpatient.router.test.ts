/**
 * Tests del outpatientRouter §10 — Beta.7 hardening layer 1.
 *
 * Cubre:
 *  - appointment.list / get (tenant isolation, NOT_FOUND)
 *  - appointment.create (happy-path, double-booking rejection)
 *  - appointment.update (state machine transitions, double-booking on reschedule)
 *  - appointment.cancel (state machine check, terminal state rejection)
 *  - appointment.detectNoShows (dryRun + commit)
 *  - consultation.create (walk-in, appointment link validation, NOT_FOUND)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { outpatientRouter } from "../outpatient.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const u2 = "00000000-0000-0000-0000-000000000002";
const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe("outpatientRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("appointment.list", () => {
    it("filtra por organizationId y aplica filtros opcionales", async () => {
      prisma.outpatientAppointment.findMany.mockResolvedValue([] as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.appointment.list({
        providerId: u, patientId: u, status: "SCHEDULED",
        fromDate: new Date(), toDate: future, limit: 10,
      });
      const args = prisma.outpatientAppointment.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBeTruthy();
      expect(args!.where!.deletedAt).toBeNull();
      expect(args!.take).toBe(10);
    });
  });

  describe("appointment.get", () => {
    it("retorna appointment encontrado", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ id: u } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.appointment.get({ id: u });
      expect(r.id).toBe(u);
    });

    it("retorna NOT_FOUND si no existe en tenant", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue(null as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.appointment.get({ id: u })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("appointment.create", () => {
    it("inyecta organizationId y createdBy del contexto (sin conflicto)", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue(null as never);
      prisma.outpatientAppointment.create.mockResolvedValue({ id: u } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.appointment.create({
        patientId: u, providerId: u, establishmentId: u,
        scheduledAt: future, durationMinutes: 30,
      });
      const args = prisma.outpatientAppointment.create.mock.calls[0]![0];
      expect(args.data.organizationId).toBeTruthy();
      expect(args.data.createdBy).toBeTruthy();
      expect(args.data.durationMinutes).toBe(30);
    });

    it("acepta reasonCategory en create", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue(null as never);
      prisma.outpatientAppointment.create.mockResolvedValue({ id: u } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.appointment.create({
        patientId: u, providerId: u, establishmentId: u,
        scheduledAt: future, reasonCategory: "ACUTE",
      });
      const args = prisma.outpatientAppointment.create.mock.calls[0]![0];
      expect(args.data.reasonCategory).toBe("ACUTE");
    });

    it("rechaza con CONFLICT si hay double-booking solapado", async () => {
      const existingStart = new Date(future.getTime() - 10 * 60_000);
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        id: u2, scheduledAt: existingStart, durationMinutes: 30,
      } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.create({
          patientId: u, providerId: u, establishmentId: u,
          scheduledAt: future, durationMinutes: 20,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("no rechaza si overlap candidato termina exactamente al inicio", async () => {
      const existingStart = new Date(future.getTime() - 30 * 60_000);
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        id: u2, scheduledAt: existingStart, durationMinutes: 30,
      } as never);
      prisma.outpatientAppointment.create.mockResolvedValue({ id: u } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.appointment.create({
        patientId: u, providerId: u, establishmentId: u,
        scheduledAt: future, durationMinutes: 20,
      });
      expect(r).toBeDefined();
    });
  });

  describe("appointment.update — state machine", () => {
    it("permite transicion valida SCHEDULED -> CONFIRMED", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        status: "SCHEDULED", providerId: u, scheduledAt: future, durationMinutes: 20,
      } as never);
      prisma.outpatientAppointment.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.appointment.update({ id: u, status: "CONFIRMED" });
      expect(r.ok).toBe(true);
    });

    it("permite transicion valida CONFIRMED -> CHECKED_IN", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        status: "CONFIRMED", providerId: u, scheduledAt: future, durationMinutes: 20,
      } as never);
      prisma.outpatientAppointment.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.appointment.update({ id: u, status: "CHECKED_IN" });
      expect(r.ok).toBe(true);
    });

    it("permite transicion valida CHECKED_IN -> COMPLETED", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        status: "CHECKED_IN", providerId: u, scheduledAt: future, durationMinutes: 20,
      } as never);
      prisma.outpatientAppointment.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.appointment.update({ id: u, status: "COMPLETED" });
      expect(r.ok).toBe(true);
    });

    it("rechaza transicion invalida COMPLETED -> SCHEDULED", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        status: "COMPLETED", providerId: u, scheduledAt: future, durationMinutes: 20,
      } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.update({ id: u, status: "SCHEDULED" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza transicion de estado terminal NO_SHOW", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        status: "NO_SHOW", providerId: u, scheduledAt: future, durationMinutes: 20,
      } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.update({ id: u, status: "CONFIRMED" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("NOT_FOUND si updateMany.count === 0 sin status change", async () => {
      prisma.outpatientAppointment.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.update({ id: u, notes: "cambio de notas" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rechaza double-booking al reprogramar con status change", async () => {
      const conflictStart = new Date(future.getTime() - 5 * 60_000);
      prisma.outpatientAppointment.findFirst
        .mockResolvedValueOnce({
          status: "SCHEDULED", providerId: u, scheduledAt: past, durationMinutes: 20,
        } as never)
        .mockResolvedValueOnce({
          id: u2, scheduledAt: conflictStart, durationMinutes: 30,
        } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.update({ id: u, status: "CONFIRMED", scheduledAt: future }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("appointment.cancel", () => {
    it("cancela appointment en estado SCHEDULED", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ status: "SCHEDULED" } as never);
      prisma.outpatientAppointment.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.appointment.cancel({ id: u, reason: "Paciente cancelo" });
      const args = prisma.outpatientAppointment.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("CANCELLED");
      expect((args.data as { notes: string }).notes).toBe("Paciente cancelo");
    });

    it("rechaza cancelacion de appointment COMPLETED (terminal)", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ status: "COMPLETED" } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.cancel({ id: u, reason: "Cancelar completado" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza cancelacion de appointment ya CANCELLED", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ status: "CANCELLED" } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.cancel({ id: u, reason: "Ya cancelado" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("NOT_FOUND si appointment no existe en cancel", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue(null as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.cancel({ id: u, reason: "reason" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("appointment.detectNoShows", () => {
    const candidates = [{ id: u, scheduledAt: past, providerId: u, patientId: u }];

    it("dryRun retorna candidatos sin modificar BD", async () => {
      prisma.outpatientAppointment.findMany.mockResolvedValue(candidates as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.appointment.detectNoShows({ thresholdMinutes: 30, commit: false });
      expect(r.count).toBe(1);
      expect(r.committed).toBe(false);
      expect(prisma.outpatientAppointment.updateMany).not.toHaveBeenCalled();
    });

    it("commit=true marca candidatos como NO_SHOW", async () => {
      prisma.outpatientAppointment.findMany.mockResolvedValue(candidates as never);
      prisma.outpatientAppointment.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.appointment.detectNoShows({ thresholdMinutes: 30, commit: true });
      expect(r.count).toBe(1);
      expect(r.committed).toBe(true);
      const args = prisma.outpatientAppointment.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("NO_SHOW");
    });

    it("commit=true con lista vacia no llama updateMany", async () => {
      prisma.outpatientAppointment.findMany.mockResolvedValue([] as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.appointment.detectNoShows({ thresholdMinutes: 30, commit: true });
      expect(r.count).toBe(0);
      expect(prisma.outpatientAppointment.updateMany).not.toHaveBeenCalled();
    });

    it("usa threshold personalizado en query", async () => {
      prisma.outpatientAppointment.findMany.mockResolvedValue([] as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.appointment.detectNoShows({ thresholdMinutes: 60, commit: false });
      const args = prisma.outpatientAppointment.findMany.mock.calls[0]![0];
      expect((args!.where!.status as { in: string[] }).in).toEqual(
        expect.arrayContaining(["SCHEDULED", "CONFIRMED"]),
      );
    });
  });

  describe("consultation.create", () => {
    it("NOT_FOUND si encounter no pertenece a tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.consultation.create({ encounterId: u, reasonOfVisit: "Control" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea walk-in consultation sin appointmentId", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.outpatientConsultation.create.mockResolvedValue({ id: u } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.consultation.create({ encounterId: u, reasonOfVisit: "Control" });
      expect(r.id).toBe(u);
      expect(prisma.outpatientAppointment.findFirst).not.toHaveBeenCalled();
    });

    it("crea consultation con appointment en CHECKED_IN", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ status: "CHECKED_IN" } as never);
      prisma.outpatientConsultation.create.mockResolvedValue({ id: u } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.consultation.create({
        encounterId: u, appointmentId: u, reasonOfVisit: "Control", reasonCategory: "ROUTINE",
      });
      expect(r.id).toBe(u);
    });

    it("crea consultation con appointment en COMPLETED", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ status: "COMPLETED" } as never);
      prisma.outpatientConsultation.create.mockResolvedValue({ id: u } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.consultation.create({
        encounterId: u, appointmentId: u, reasonOfVisit: "Revision final",
      });
      expect(r.id).toBe(u);
    });

    it("rechaza consultation si appointment esta en SCHEDULED", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ status: "SCHEDULED" } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.consultation.create({ encounterId: u, appointmentId: u, reasonOfVisit: "Control" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza consultation si appointment esta en CONFIRMED", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.outpatientAppointment.findFirst.mockResolvedValue({ status: "CONFIRMED" } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.consultation.create({ encounterId: u, appointmentId: u, reasonOfVisit: "Control" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza si appointmentId no existe en tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.outpatientAppointment.findFirst.mockResolvedValue(null as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.consultation.create({ encounterId: u, appointmentId: u2, reasonOfVisit: "Control" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});