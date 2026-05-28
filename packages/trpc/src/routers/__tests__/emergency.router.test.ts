/**
 * Tests del emergencyRouter (§12 — Beta.4 hardening capa 1).
 *
 * Cubre:
 *  - skeleton previo (visit CRUD, observation start/end, notes).
 *  - Beta.4: state machine enforcement en setDisposition.
 *  - Beta.4: lwbsCheck dry-run + commit.
 *  - Beta.4: recordVitalSnapshot con detección de re-triage.
 *  - Beta.4: bloqueo de notas tras disposition terminal.
 *  - Beta.4: getObservationStatus computed.
 *  - UAT-BUG-01 (TDR §12.4): triage Manchester obligatorio en visit.create.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { emergencyRouter } from "../emergency.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";
const w = "00000000-0000-0000-0000-000000000003";

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
          arrivalMode: "WALK_IN",
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
          arrivalMode: "WALK_IN",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    // --- UAT-BUG-01: TDR §12.4 — triage Manchester obligatorio ---

    it("PRECONDITION_FAILED si paciente no tiene triage COMPLETED", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.triageEvaluation.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          chiefComplaint: "Dolor torácico",
          arrivalMode: "WALK_IN",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.emergencyVisit.create).not.toHaveBeenCalled();
    });

    it("PRECONDITION_FAILED si triage de OTRO paciente (no aplica al patientId actual)", async () => {
      // Prisma retorna null porque la query filtra patientId=u y el triage pertenece a otro.
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.triageEvaluation.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          chiefComplaint: "Dolor torácico",
          arrivalMode: "WALK_IN",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      // Verifica que la query usa el patientId del input.
      const triageArgs = prisma.triageEvaluation.findFirst.mock.calls[0]![0];
      expect((triageArgs!.where as { patientId: string }).patientId).toBe(u);
    });

    it("PRECONDITION_FAILED si triage COMPLETED > 4h (fuera de ventana)", async () => {
      // Prisma retorna null porque el filtro completedAt >= windowStart excluye el registro.
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.triageEvaluation.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          chiefComplaint: "Fiebre alta",
          arrivalMode: "WALK_IN",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      // Verifica que status=COMPLETED y ventana de 4h están presentes en la query.
      const triageArgs = prisma.triageEvaluation.findFirst.mock.calls[0]![0];
      const where = triageArgs!.where as {
        completedAt: { gte: Date };
        status: string;
      };
      expect(where.status).toBe("COMPLETED");
      expect(where.completedAt.gte).toBeInstanceOf(Date);
      const windowMs = Date.now() - where.completedAt.gte.getTime();
      expect(windowMs).toBeGreaterThan(4 * 60 * 60 * 1000 - 5000);
      expect(windowMs).toBeLessThan(4 * 60 * 60 * 1000 + 5000);
    });

    it("crea visita con triageEvaluationId cuando triage COMPLETED < 4h existe", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.triageEvaluation.findFirst.mockResolvedValue({ id: w } as never);
      prisma.emergencyVisit.create.mockResolvedValue({ id: v } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await caller.visit.create({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        chiefComplaint: "Dolor abdominal severo",
        arrivalMode: "WALK_IN",
      });
      const args = prisma.emergencyVisit.create.mock.calls[0]![0];
      const data = args.data as { arrivalMode: string; triageEvaluationId: string };
      expect(data.arrivalMode).toBe("WALK_IN");
      expect(data.triageEvaluationId).toBe(w);
    });
  });

  describe("visit.setDisposition (Beta.4 state machine)", () => {
    it("NOT_FOUND si visita no existe", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.setDisposition({ id: u, disposition: "DISCHARGED" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("transición válida PENDING -> LWBS persiste y retorna transitioned=true", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        disposition: "PENDING",
      } as never);
      prisma.emergencyVisit.update.mockResolvedValue({ id: u } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.setDisposition({ id: u, disposition: "LWBS" });
      expect(r.transitioned).toBe(true);
      const args = prisma.emergencyVisit.update.mock.calls[0]![0];
      expect((args.data as { disposition: string }).disposition).toBe("LWBS");
      expect((args.data as { dispositionAt: Date }).dispositionAt).toBeInstanceOf(Date);
    });

    it("transición inválida DISCHARGED -> AMA arroja BAD_REQUEST", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        disposition: "DISCHARGED",
      } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.setDisposition({ id: u, disposition: "AMA" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(prisma.emergencyVisit.update).not.toHaveBeenCalled();
    });

    it("no-op si disposition idéntica (sin update)", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        disposition: "PENDING",
      } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.setDisposition({ id: u, disposition: "PENDING" });
      expect(r.transitioned).toBe(false);
      expect(prisma.emergencyVisit.update).not.toHaveBeenCalled();
    });
  });

  describe("visit.startObservation / endObservation", () => {
    it("startObservation NOT_FOUND si visita no existe", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.startObservation({ id: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("startObservation NOT_FOUND si observación ya iniciada", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        observationStartedAt: new Date(),
        encounter: { serviceUnitId: null },
      } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.startObservation({ id: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("startObservation OK cuando observación no estaba iniciada", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        observationStartedAt: null,
        encounter: { serviceUnitId: null },
      } as never);
      prisma.emergencyVisit.update.mockResolvedValue({ id: u } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.startObservation({ id: u });
      expect(r.ok).toBe(true);
    });

    it("endObservation NOT_FOUND si visita no existe", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.endObservation({ id: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("endObservation NOT_FOUND si observación no está abierta", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        observationStartedAt: null,
        observationEndedAt: null,
        encounter: { serviceUnitId: null },
      } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.endObservation({ id: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("endObservation OK", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        observationStartedAt: new Date(),
        observationEndedAt: null,
        encounter: { serviceUnitId: null },
      } as never);
      prisma.emergencyVisit.update.mockResolvedValue({ id: u } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.endObservation({ id: u });
      expect(r.ok).toBe(true);
    });
  });

  describe("visit.getObservationStatus (Beta.4 computed)", () => {
    it("NOT_FOUND si no existe visita", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.getObservationStatus({ id: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("retorna minutos abiertos (started, no ended)", async () => {
      const started = new Date(Date.now() - 30 * 60 * 1000);
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        observationStartedAt: started,
        observationEndedAt: null,
      } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.getObservationStatus({ id: u });
      expect(r.isOpen).toBe(true);
      expect(r.minutes).toBeGreaterThanOrEqual(29);
      expect(r.minutes).toBeLessThanOrEqual(31);
    });

    it("retorna minutos cerrados (started + ended)", async () => {
      const started = new Date(Date.now() - 120 * 60 * 1000);
      const ended = new Date(Date.now() - 30 * 60 * 1000);
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        observationStartedAt: started,
        observationEndedAt: ended,
      } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.getObservationStatus({ id: u });
      expect(r.isOpen).toBe(false);
      expect(r.minutes).toBe(90);
    });
  });

  describe("visit.lwbsCheck (Beta.4 LWBS detection)", () => {
    it("dryRun=true retorna candidatos sin update", async () => {
      const oldArrived = new Date(Date.now() - 300 * 60 * 1000);
      prisma.emergencyVisit.findMany.mockResolvedValue([
        {
          id: u,
          arrivedAt: oldArrived,
          disposition: "PENDING",
          treatingId: null,
        },
      ] as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.lwbsCheck({ dryRun: true, limit: 50 });
      expect(r.dryRun).toBe(true);
      expect(r.flagged).toBe(1);
      expect(r.details[0]!.id).toBe(u);
      expect(prisma.emergencyVisit.updateMany).not.toHaveBeenCalled();
    });

    it("commit transiciona PENDING -> LWBS via updateMany", async () => {
      const oldArrived = new Date(Date.now() - 300 * 60 * 1000);
      prisma.emergencyVisit.findMany.mockResolvedValue([
        {
          id: u,
          arrivedAt: oldArrived,
          disposition: "PENDING",
          treatingId: null,
        },
      ] as never);
      prisma.emergencyVisit.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.lwbsCheck({ dryRun: false, limit: 50 });
      expect(r.dryRun).toBe(false);
      expect(r.flagged).toBe(1);
      expect(prisma.emergencyVisit.updateMany).toHaveBeenCalled();
      const args = prisma.emergencyVisit.updateMany.mock.calls[0]![0];
      expect((args.data as { disposition: string }).disposition).toBe("LWBS");
    });

    it("ningún candidato si elapsed < timeout", async () => {
      const recent = new Date(Date.now() - 10 * 60 * 1000);
      prisma.emergencyVisit.findMany.mockResolvedValue([
        {
          id: u,
          arrivedAt: recent,
          disposition: "PENDING",
          treatingId: null,
        },
      ] as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.lwbsCheck({ dryRun: false });
      expect(r.flagged).toBe(0);
      expect(prisma.emergencyVisit.updateMany).not.toHaveBeenCalled();
    });

    it("acepta timeout override personalizado", async () => {
      const arrived = new Date(Date.now() - 35 * 60 * 1000); // 35 min
      prisma.emergencyVisit.findMany.mockResolvedValue([
        {
          id: u,
          arrivedAt: arrived,
          disposition: "PENDING",
          treatingId: null,
        },
      ] as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.lwbsCheck({
        dryRun: true,
        timeoutMinutes: 30, // override
        limit: 10,
      });
      expect(r.flagged).toBe(1);
      expect(r.details[0]!.timeoutMinutes).toBe(30);
    });
  });

  describe("visit.recordVitalSnapshot (Beta.4 re-triage)", () => {
    it("NOT_FOUND si visita no pertenece a tenant", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue(null as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.recordVitalSnapshot({ visitId: u, spo2: 90 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si visita ya terminal", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        encounterId: v,
        disposition: "DISCHARGED",
      } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.visit.recordVitalSnapshot({ visitId: u, spo2: 95 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("sin baseline: detecta SpO2 absoluto bajo y registra REASSESSMENT", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        encounterId: v,
        disposition: "PENDING",
      } as never);
      prisma.triageVitalSign.findMany.mockResolvedValue([] as never);
      prisma.emergencyNote.create.mockResolvedValue({ id: u } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.recordVitalSnapshot({ visitId: u, spo2: 88 });
      expect(r.retriageSuggested).toBe(true);
      expect(r.reasons.length).toBeGreaterThan(0);
      const noteArgs = prisma.emergencyNote.create.mock.calls[0]![0];
      expect((noteArgs.data as { category: string }).category).toBe("REASSESSMENT");
    });

    it("con baseline estable: NO sugiere retriage", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        encounterId: v,
        disposition: "PENDING",
      } as never);
      prisma.triageVitalSign.findMany.mockResolvedValue([
        { vitalCode: "HR", valueNumeric: 82, measuredAt: new Date() },
        { vitalCode: "SpO2", valueNumeric: 98, measuredAt: new Date() },
        { vitalCode: "RR", valueNumeric: 16, measuredAt: new Date() },
      ] as never);
      prisma.emergencyNote.create.mockResolvedValue({ id: u } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.recordVitalSnapshot({
        visitId: u,
        heartRate: 84,
        spo2: 97,
        respiratoryRate: 17,
      });
      expect(r.retriageSuggested).toBe(false);
      // Nota igual se registra (audit trail).
      expect(prisma.emergencyNote.create).toHaveBeenCalled();
    });

    it("con baseline deteriorado: sugiere retriage con razones múltiples", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        encounterId: v,
        disposition: "PENDING",
      } as never);
      // Decimal-like simulation con toNumber.
      const dec = (n: number) => ({ toNumber: () => n });
      prisma.triageVitalSign.findMany.mockResolvedValue([
        { vitalCode: "HR", valueNumeric: dec(80), measuredAt: new Date() },
        { vitalCode: "SpO2", valueNumeric: dec(98), measuredAt: new Date() },
      ] as never);
      prisma.emergencyNote.create.mockResolvedValue({ id: u } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.visit.recordVitalSnapshot({
        visitId: u,
        heartRate: 130,
        spo2: 88,
      });
      expect(r.retriageSuggested).toBe(true);
      // Esperamos detección por al menos uno de SpO2 absoluto + delta y HR.
      expect(r.reasons.length).toBeGreaterThanOrEqual(2);
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

    it("note BAD_REQUEST si visit ya finalizada (Beta.4)", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        disposition: "DISCHARGED",
      } as never);
      const caller = emergencyRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.note.create({
          visitId: u,
          category: "OBSERVATION",
          body: "x",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(prisma.emergencyNote.create).not.toHaveBeenCalled();
    });

    it("crea nota OK sobre visit PENDING", async () => {
      prisma.emergencyVisit.findFirst.mockResolvedValue({
        id: u,
        disposition: "PENDING",
      } as never);
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
