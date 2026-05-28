/**
 * Tests del inpatientRouter (§11 — Wave 7 Phase 2 + Beta.1 hardening).
 *
 * Cubre tenant-isolation, NOT_FOUND, happy-path, validación cruzada
 * encounter↔patient y reglas Beta.1:
 *   - State machine (canTransitionInpatient) en discharge/goOnLeave/
 *     returnFromLeave/transferOut.
 *   - Vital alerts inline en vitals.record.
 *   - Auto-link bed assignment al admit + release al alta.
 *   - Kardex bloqueado en estados terminales.
 *
 * Reglas avanzadas (LOS automático, infecciones nosocomiales) Wave 2.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { inpatientRouter } from "../inpatient.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";
const w = "00000000-0000-0000-0000-000000000003";

/**
 * Simula prisma.$transaction(cb) llamando cb con la misma instancia mock
 * (así no necesitamos mockDeep recursivamente). Útil para tests que sólo
 * verifican que las operaciones se invoquen en orden.
 */
function wireTransaction(prisma: DeepMockProxy<PrismaClient>): void {
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
}

describe("inpatientRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    wireTransaction(prisma);
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

    it("crea admisión cuando encounter+patient son consistentes (sin bedId)", async () => {
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
      // No se llama a bed.create si no hay bedId
      expect(prisma.bedAssignment.create).not.toHaveBeenCalled();
    });

    it("Beta.1 — NOT_FOUND si bedId no pertenece a la organización", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.bed.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          attendingId: u,
          reason: "ICC",
          bedId: w,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("Beta.1 — PRECONDITION_FAILED si la cama no está FREE", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.bed.findFirst.mockResolvedValue({
        id: w,
        status: "OCCUPIED",
        establishmentId: u,
      } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          attendingId: u,
          reason: "ICC",
          bedId: w,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("Beta.1 — BAD_REQUEST si la cama es de otro establishment", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.bed.findFirst.mockResolvedValue({
        id: w,
        status: "FREE",
        establishmentId: v,
      } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.create({
          encounterId: u,
          establishmentId: u,
          patientId: u,
          attendingId: u,
          reason: "ICC",
          bedId: w,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("Beta.1 — auto-link de cama crea BedAssignment y marca cama OCCUPIED", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.bed.findFirst.mockResolvedValue({
        id: w,
        status: "FREE",
        establishmentId: u,
      } as never);
      prisma.inpatientAdmission.create.mockResolvedValue({ id: u } as never);
      prisma.bedAssignment.create.mockResolvedValue({ id: w } as never);
      prisma.bed.update.mockResolvedValue({ id: w, status: "OCCUPIED" } as never);

      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.admission.create({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        attendingId: u,
        reason: "ICC",
        bedId: w,
        bedAssignmentReason: "Asignación inicial",
      });
      expect(prisma.bedAssignment.create).toHaveBeenCalled();
      expect(prisma.bed.update).toHaveBeenCalledWith({
        where: { id: w },
        data: { status: "OCCUPIED" },
      });
    });
  });

  describe("admission.discharge (Beta.1 state machine)", () => {
    it("NOT_FOUND si la admisión no existe", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.discharge({ id: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("PRECONDITION_FAILED si admisión está ya DISCHARGED (terminal)", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "DISCHARGED",
        encounterId: u,
      } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.discharge({ id: u }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("OK desde ACTIVE → DISCHARGED y libera camas activas", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
        encounterId: u,
      } as never);
      prisma.inpatientAdmission.update.mockResolvedValue({ id: u } as never);
      prisma.bedAssignment.findMany.mockResolvedValue([
        { id: w, bedId: w },
      ] as never);
      prisma.bedAssignment.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.bed.update.mockResolvedValue({ id: w } as never);

      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.admission.discharge({ id: u, notes: "Alta médica" });
      expect(r.ok).toBe(true);
      expect(prisma.bedAssignment.updateMany).toHaveBeenCalled();
      expect(prisma.bed.update).toHaveBeenCalledWith({
        where: { id: w },
        data: { status: "FREE" },
      });
    });

    it("OK desde ON_LEAVE → DISCHARGED (transición permitida)", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ON_LEAVE",
        encounterId: u,
      } as never);
      prisma.inpatientAdmission.update.mockResolvedValue({ id: u } as never);
      prisma.bedAssignment.findMany.mockResolvedValue([] as never);

      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.admission.discharge({ id: u });
      expect(r.ok).toBe(true);
    });
  });

  describe("admission.goOnLeave (Beta.1)", () => {
    it("NOT_FOUND si admisión no existe", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.goOnLeave({ id: u, reason: "Pase fin de semana" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("PRECONDITION_FAILED si admisión ya está ON_LEAVE", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ON_LEAVE",
        notes: null,
      } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.goOnLeave({ id: u, reason: "fp" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("OK ACTIVE → ON_LEAVE y appendea nota con timestamp", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
        notes: "Nota previa",
      } as never);
      prisma.inpatientAdmission.update.mockResolvedValue({ id: u } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.admission.goOnLeave({
        id: u,
        reason: "Pase domiciliario 24h",
      });
      expect(r.ok).toBe(true);
      const args = prisma.inpatientAdmission.update.mock.calls[0]![0];
      const notes = (args.data as { notes: string }).notes;
      expect(notes).toContain("Nota previa");
      expect(notes).toContain("[ON_LEAVE] Pase domiciliario 24h");
    });
  });

  describe("admission.returnFromLeave (Beta.1)", () => {
    it("NOT_FOUND si admisión no existe", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.returnFromLeave({ id: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("PRECONDITION_FAILED si admisión está en ACTIVE (no admite re-active)", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
        notes: null,
      } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.returnFromLeave({ id: u }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("OK ON_LEAVE → ACTIVE", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ON_LEAVE",
        notes: null,
      } as never);
      prisma.inpatientAdmission.update.mockResolvedValue({ id: u } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.admission.returnFromLeave({
        id: u,
        notes: "Retorno sin complicaciones",
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("admission.transferOut (Beta.1)", () => {
    it("NOT_FOUND si admisión no existe", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.transferOut({
          id: u,
          destinationName: "Hospital X",
          reason: "Mayor complejidad",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("PRECONDITION_FAILED si admisión está en DISCHARGED (terminal)", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "DISCHARGED",
        notes: null,
        encounterId: u,
      } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admission.transferOut({
          id: u,
          destinationName: "X",
          reason: "y",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("OK ACTIVE → TRANSFERRED_OUT y libera camas activas", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
        notes: null,
        encounterId: u,
      } as never);
      prisma.inpatientAdmission.update.mockResolvedValue({ id: u } as never);
      prisma.bedAssignment.findMany.mockResolvedValue([
        { id: w, bedId: w },
      ] as never);
      prisma.bedAssignment.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.bed.update.mockResolvedValue({ id: w } as never);

      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.admission.transferOut({
        id: u,
        destinationName: "Hospital Bloom",
        reason: "Trasplante hepático",
        notes: "Coordinado con cirujano",
      });
      expect(r.ok).toBe(true);
      const args = prisma.inpatientAdmission.update.mock.calls[0]![0];
      const notes = (args.data as { notes: string }).notes;
      expect(notes).toContain("[TRANSFER_OUT to Hospital Bloom]");
      expect(notes).toContain("Trasplante hepático");
    });
  });

  describe("vitals.record (Beta.1 alerts)", () => {
    it("NOT_FOUND si admission no pertenece al tenant", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.vitals.record({ admissionId: u, heartRate: 80 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("PRECONDITION_FAILED si admisión está DISCHARGED", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "DISCHARGED",
      } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.vitals.record({ admissionId: u, heartRate: 80 }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("registra vitales en ACTIVE y devuelve alerts vacías si están en rango", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
        patientId: v,
      } as never);
      prisma.inpatientVitals.create.mockResolvedValue({ id: u } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.vitals.record({
        admissionId: u,
        temperatureC: 37.0,
        heartRate: 75,
        respiratoryRate: 16,
        systolicBp: 120,
        diastolicBp: 80,
        spo2: 98,
        painScale: 2,
      });
      expect(r.vitals).toBeDefined();
      expect(r.alerts).toEqual([]);
      expect(prisma.domainEvent.create).not.toHaveBeenCalled();
    });

    it("genera alerta CRITICAL para spo2 ≤ 88", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
        patientId: v,
      } as never);
      prisma.inpatientVitals.create.mockResolvedValue({ id: u } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: w } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.vitals.record({
        admissionId: u,
        spo2: 85,
      });
      expect(r.alerts).toHaveLength(1);
      expect(r.alerts[0]!.severity).toBe("critical");
      expect(r.alerts[0]!.field).toBe("spo2");
    });

    it("genera alerta WARN para taquicardia 115", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
        patientId: v,
      } as never);
      prisma.inpatientVitals.create.mockResolvedValue({ id: u } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.vitals.record({
        admissionId: u,
        heartRate: 115,
      });
      expect(r.alerts).toHaveLength(1);
      expect(r.alerts[0]!.severity).toBe("warn");
      expect(r.alerts[0]!.field).toBe("heartRate");
    });

    it("genera múltiples alerts cuando varios vitales están fuera de rango", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
        patientId: v,
      } as never);
      prisma.inpatientVitals.create.mockResolvedValue({ id: u } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: w } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.vitals.record({
        admissionId: u,
        heartRate: 135, // critical
        spo2: 90, // warn
        temperatureC: 39.6, // critical
      });
      expect(r.alerts.length).toBeGreaterThanOrEqual(3);
      expect(r.alerts.some((a) => a.severity === "critical")).toBe(true);
    });

    /**
     * Beta.15 (US.B15.4.1) — wiring outbox `vital.critical`.
     * AC backlog: SPO2=82 dispara DomainEvent con eventType vital.critical
     * y payload que incluye admissionId, patientId, sourceRowId, alerts.
     */
    describe("Beta.15 outbox emission (vital.critical)", () => {
      it("emite DomainEvent vital.critical cuando hay alerta CRITICAL", async () => {
        prisma.inpatientAdmission.findFirst.mockResolvedValue({
          id: u,
          status: "ACTIVE",
          patientId: v,
        } as never);
        prisma.inpatientVitals.create.mockResolvedValue({ id: u } as never);
        prisma.domainEvent.create.mockResolvedValue({ id: w } as never);

        const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
        await caller.vitals.record({ admissionId: u, spo2: 82 });

        expect(prisma.domainEvent.create).toHaveBeenCalledTimes(1);
        const args = prisma.domainEvent.create.mock.calls[0]![0];
        expect(args.data.eventType).toBe("vital.critical");
        expect(args.data.aggregateType).toBe("InpatientVitals");
        expect(args.data.aggregateId).toBe(u);
        const payload = args.data.payload as Record<string, unknown>;
        expect(payload.source).toBe("InpatientVitals");
        expect(payload.admissionId).toBe(u);
        expect(payload.patientId).toBe(v);
        expect(payload.sourceRowId).toBe(u);
        const alerts = payload.alerts as Array<Record<string, unknown>>;
        expect(alerts.length).toBeGreaterThanOrEqual(1);
        expect(alerts[0]!.parameter).toBe("SPO2");
        expect(alerts[0]!.severity).toBe("CRITICAL");
      });

      it("NO emite DomainEvent si sólo hay alertas WARN", async () => {
        prisma.inpatientAdmission.findFirst.mockResolvedValue({
          id: u,
          status: "ACTIVE",
          patientId: v,
        } as never);
        prisma.inpatientVitals.create.mockResolvedValue({ id: u } as never);

        const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
        await caller.vitals.record({ admissionId: u, heartRate: 115 });

        expect(prisma.domainEvent.create).not.toHaveBeenCalled();
      });

      it("incluye alertas WARN en el payload cuando coexisten con CRITICAL", async () => {
        prisma.inpatientAdmission.findFirst.mockResolvedValue({
          id: u,
          status: "ACTIVE",
          patientId: v,
        } as never);
        prisma.inpatientVitals.create.mockResolvedValue({ id: u } as never);
        prisma.domainEvent.create.mockResolvedValue({ id: w } as never);

        const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
        await caller.vitals.record({
          admissionId: u,
          heartRate: 135, // critical
          spo2: 90, // warn
        });

        expect(prisma.domainEvent.create).toHaveBeenCalledTimes(1);
        const payload = prisma.domainEvent.create.mock.calls[0]![0].data
          .payload as Record<string, unknown>;
        const alerts = payload.alerts as Array<Record<string, unknown>>;
        const severities = alerts.map((a) => a.severity);
        expect(severities).toContain("CRITICAL");
        expect(severities).toContain("WARNING");
      });

      /**
       * US.B15.1.4 — audit log wiring (emit).
       * Cada inserción al outbox debe generar también una entrada en
       * AuditLog con action=CREATE, entity=DomainEvent, entityId=eventId,
       * y justification que incluye 'DOMAIN_EVENT_EMITTED:vital.critical'.
       */
      it("escribe AuditLog con action=CREATE tras emitir DomainEvent vital.critical", async () => {
        prisma.inpatientAdmission.findFirst.mockResolvedValue({
          id: u,
          status: "ACTIVE",
          patientId: v,
        } as never);
        prisma.inpatientVitals.create.mockResolvedValue({ id: u } as never);
        prisma.domainEvent.create.mockResolvedValue({ id: w } as never);

        const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
        await caller.vitals.record({ admissionId: u, spo2: 82 });

        expect(prisma.domainEvent.create).toHaveBeenCalledTimes(1);
        expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
        const auditArgs = prisma.auditLog.create.mock.calls[0]![0];
        const data = auditArgs.data as {
          action: string;
          entity: string;
          entityId: string;
          justification: string;
        };
        expect(data.action).toBe("CREATE");
        expect(data.entity).toBe("DomainEvent");
        expect(data.entityId).toBe(w);
        expect(data.justification).toContain("DOMAIN_EVENT_EMITTED");
        expect(data.justification).toContain("vital.critical");
      });
    });
  });

  describe("kardex.create (Beta.1 append-only / status terminal)", () => {
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

    it("Beta.1 — bloqueado en estados terminales (DISCHARGED)", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "DISCHARGED",
      } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.kardex.create({
          admissionId: u,
          category: "OBSERVATION",
          entry: "Entry tardía",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("crea kardex en ACTIVE con shift opcional", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
      } as never);
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

    it("Beta.1 — create bloqueado en terminal", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "TRANSFERRED_OUT",
      } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.carePlan.create({ admissionId: u, title: "Plan" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("create OK en ACTIVE", async () => {
      prisma.inpatientAdmission.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
      } as never);
      prisma.inpatientCarePlan.create.mockResolvedValue({ id: u } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.carePlan.create({
        admissionId: u,
        title: "Plan dolor",
        goal: "Reducir EVA a < 3",
        interventions: "Analgesia escalonada",
      });
      expect(prisma.inpatientCarePlan.create).toHaveBeenCalled();
    });

    it("updateStatus a COMPLETED setea completedAt", async () => {
      // El router ahora carga el plan primero para Nivel B scope check.
      prisma.inpatientCarePlan.findFirst.mockResolvedValue({
        id: u,
        admission: { encounter: { serviceUnitId: null } },
      } as never);
      prisma.inpatientCarePlan.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await caller.carePlan.updateStatus({ id: u, status: "COMPLETED" });
      const args = prisma.inpatientCarePlan.updateMany.mock.calls[0]![0];
      expect((args.data as { status: string }).status).toBe("COMPLETED");
      expect((args.data as { completedAt: Date }).completedAt).toBeInstanceOf(Date);
    });

    it("updateStatus NOT_FOUND si plan no existe", async () => {
      prisma.inpatientCarePlan.findFirst.mockResolvedValue(null as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.carePlan.updateStatus({ id: u, status: "ACTIVE" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("updateStatus NOT_FOUND si updateMany count===0 (race condition)", async () => {
      prisma.inpatientCarePlan.findFirst.mockResolvedValue({
        id: u,
        admission: { encounter: { serviceUnitId: null } },
      } as never);
      prisma.inpatientCarePlan.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = inpatientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.carePlan.updateStatus({ id: u, status: "ACTIVE" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
