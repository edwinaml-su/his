/**
 * Tests del outpatientRouter (§10 — Phase 2 skeleton).
 *
 * Cubre tenant-isolation, NOT_FOUND y happy-path. Reglas de negocio
 * (overlap detection, no-show automation) vendrán en iteraciones futuras.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { outpatientRouter } from "../outpatient.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const future = new Date(Date.now() + 86_400_000);

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
        providerId: u,
        patientId: u,
        status: "SCHEDULED",
        fromDate: new Date(),
        toDate: future,
        limit: 10,
      });
      const args = prisma.outpatientAppointment.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBeTruthy();
      expect(args!.where!.deletedAt).toBeNull();
      expect(args!.take).toBe(10);
    });
  });

  describe("appointment.get", () => {
    it("retorna appointment encontrado", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue({
        id: u,
      } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.appointment.get({ id: u });
      expect(r.id).toBe(u);
    });

    it("retorna NOT_FOUND si no existe en tenant", async () => {
      prisma.outpatientAppointment.findFirst.mockResolvedValue(null as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.appointment.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("appointment.create", () => {
    it("inyecta organizationId y createdBy del contexto", async () => {
      prisma.outpatientAppointment.create.mockResolvedValue({ id: u } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.appointment.create({
        patientId: u,
        providerId: u,
        establishmentId: u,
        scheduledAt: future,
        durationMinutes: 30,
      });
      const args = prisma.outpatientAppointment.create.mock.calls[0]![0];
      expect(args.data.organizationId).toBeTruthy();
      expect(args.data.createdBy).toBeTruthy();
      expect(args.data.durationMinutes).toBe(30);
    });
  });

  describe("appointment.update", () => {
    it("NOT_FOUND si updateMany.count === 0", async () => {
      prisma.outpatientAppointment.updateMany.mockResolvedValue({
        count: 0,
      } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.appointment.update({ id: u, status: "CONFIRMED" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("retorna ok=true si update exitoso", async () => {
      prisma.outpatientAppointment.updateMany.mockResolvedValue({
        count: 1,
      } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.appointment.update({ id: u, status: "CONFIRMED" });
      expect(r.ok).toBe(true);
    });
  });

  describe("appointment.cancel", () => {
    it("cambia status a CANCELLED y guarda reason en notes", async () => {
      prisma.outpatientAppointment.updateMany.mockResolvedValue({
        count: 1,
      } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.appointment.cancel({ id: u, reason: "Paciente canceló" });
      const args = prisma.outpatientAppointment.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("CANCELLED");
      expect((args.data as { notes: string }).notes).toBe("Paciente canceló");
    });
  });

  describe("consultation.create", () => {
    it("NOT_FOUND si encounter no pertenece a tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.consultation.create({
          encounterId: u,
          reasonOfVisit: "Control",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea consultation cuando encounter existe", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u } as never);
      prisma.outpatientConsultation.create.mockResolvedValue({ id: u } as never);
      const caller = outpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.consultation.create({
        encounterId: u,
        reasonOfVisit: "Control",
        subjective: "Sin novedades",
      });
      expect(r.id).toBe(u);
    });
  });
});
