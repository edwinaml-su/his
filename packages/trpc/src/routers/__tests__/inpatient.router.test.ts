/**
 * Tests del inpatientRouter (§11 — Wave 7 Phase 2 skeleton).
 *
 * Cubre tenant-isolation, NOT_FOUND, happy-path y validación cruzada
 * encounter↔patient. Reglas avanzadas (escalación de cuidados, LOS auto)
 * vendrán en iteraciones futuras.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { inpatientRouter } from "../inpatient.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";

describe("inpatientRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("admission.list", () => {
    it("filtra por organizationId y aplica filtros opcionales", async () => {
      prisma.inpatientAdmission.findMany.mockResolvedValue([] as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.admission.list({
        status: "ACTIVE",
        patientId: u,
        attendingId: u,
        establishmentId: u,
        limit: 25,
      });
      const args = prisma.inpatientAdmission.findMany.mock.calls[0]![0];
      expect(args!.where!.organizationId).toBeTruthy();
      expect(args!.where!.deletedAt).toBeNull();
      expect(args!.take).toBe(25);
    });
  });

  describe("admission.get", () => {
    it("retorna admission encontrada", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({ id: u } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.admission.get({ id: u });
      expect(r.id).toBe(u);
    });

    it("retorna NOT_FOUND si no existe en tenant", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.admission.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("admission.create", () => {
    it("retorna NOT_FOUND si encounter no pertenece al tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          attendingId: u,
          reason: "ICC",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("retorna BAD_REQUEST si patientId no coincide con encounter.patientId", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: v } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          attendingId: u,
          reason: "ICC",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("crea admisión cuando encounter+patient son consistentes", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.inpatientAdmission.create.mockResolvedValue({ id: u } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.admission.create({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        attendingId: u,
        reason: "ICC descompensada",
      });
      const args = prisma.inpatientAdmission.create.mock.calls[0]![0];
      expect(args.data.organizationId).toBeTruthy();
      expect(args.data.createdBy).toBeTruthy();
    });
  });

  describe("admission.discharge", () => {
    it("NOT_FOUND si updateMany.count === 0", async () => {
      prisma.inpatientAdmission.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.discharge({ id: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("OK cuando se actualiza", async () => {
      prisma.inpatientAdmission.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.admission.discharge({ id: u, notes: "Alta hospitalaria" });
      expect(r.ok).toBe(true);
      const args = prisma.inpatientAdmission.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("DISCHARGED");
    });
  });

  describe("vitals.record", () => {
    it("NOT_FOUND si admission no pertenece al tenant", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.vitals.record({ admissionId: u, heartRate: 80 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("registra vitals cuando admission existe", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({ id: u } as never);
      prisma.inpatientVitals.create.mockResolvedValue({ id: u } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.vitals.record({
        admissionId: u,
        temperatureC: 37.5,
        heartRate: 88,
        spo2: 97,
      });
      const args = prisma.inpatientVitals.create.mock.calls[0]![0];
      expect(args.data.admissionId).toBe(u);
      expect(args.data.recordedById).toBeTruthy();
    });
  });

  describe("kardex.create", () => {
    it("NOT_FOUND si admission no existe", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.kardex.create({
          admissionId: u,
          category: "DIET",
          entry: "Dieta blanda",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea kardex con shift opcional", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({ id: u } as never);
      prisma.inpatientKardex.create.mockResolvedValue({ id: u } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.kardex.create({
        admissionId: u,
        category: "OBSERVATION",
        entry: "Paciente refiere mejoría",
        shift: "AFTERNOON",
      });
      const args = prisma.inpatientKardex.create.mock.calls[0]![0];
      expect(args.data.shift).toBe("AFTERNOON");
    });
  });

  describe("carePlan.create / updateStatus", () => {
    it("create NOT_FOUND si admission no existe", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.carePlan.create({ admissionId: u, title: "Plan dolor" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("updateStatus a COMPLETED setea completedAt", async () => {
      prisma.inpatientCarePlan.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.carePlan.updateStatus({ id: u, status: "COMPLETED" });
      const args = prisma.inpatientCarePlan.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("COMPLETED");
      expect((args.data as { completedAt: Date }).completedAt).toBeInstanceOf(Date);
    });

    it("updateStatus NOT_FOUND si count===0", async () => {
      prisma.inpatientCarePlan.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.carePlan.updateStatus({ id: u, status: "ACTIVE" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
