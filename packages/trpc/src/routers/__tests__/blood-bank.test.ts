/**
 * Tests del bloodBankRouter (§15 — Beta.16 banco de sangre).
 *
 * Cubre:
 *   - unit.list: filtra por organizationId, respeta filtros opcionales.
 *   - unit.create: NOT_FOUND si banco no es del tenant; OK crea unidad.
 *   - unit.discard: NOT_FOUND; PRECONDITION si estado terminal; OK descarta.
 *   - request.create: NOT_FOUND si encounter no existe; BAD_REQUEST si patientId no coincide; OK.
 *   - request.cancel: NOT_FOUND si no está en open-state; OK cancela.
 *   - crossMatch.perform: NOT_FOUND si solicitud inválida; NOT_FOUND si unidad inválida;
 *     OK compatible (status → APPROVED, no emite evento);
 *     OK incompatible (status → CROSSMATCHING, emite transfusion.crossmatchFailed).
 *   - transfusion.start: NOT_FOUND si request no APPROVED; PRECONDITION si no COMPATIBLE crossmatch; OK.
 *   - transfusion.complete: NOT_FOUND; OK.
 *   - transfusion.recordReaction: NOT_FOUND; PRECONDITION si ya terminal;
 *     OK mild (no emite evento); OK severe (emite transfusion.adverseReaction).
 *   - Control de roles: LAB_ROLES requeridos en unit.create, crossMatch.perform.
 *   - Tenant isolation: organizationId del tenant siempre inyectado.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { bloodBankRouter } from "../blood-bank.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = MOCK_TENANT.organizationId;
const u = "00000000-0000-0000-0000-000000000001";
const u2 = "00000000-0000-0000-0000-000000000002";
const u3 = "00000000-0000-0000-0000-000000000003";
const u4 = "00000000-0000-0000-0000-000000000004";

const BLOOD_BANK = { id: u };
const BLOOD_UNIT = { id: u2, status: "AVAILABLE", unitId: u2, expirationDate: new Date("2027-01-01") };
const ENCOUNTER = { id: u3, patientId: u };
const TRANSFUSION_REQUEST_APPROVED = { id: u4, requestedById: u, patientId: u, encounterId: u3 };
const CROSS_MATCH_COMPATIBLE = { id: u, requestId: u4, unitId: u2, result: "COMPATIBLE" };
const TRANSFUSION_STARTED = {
  id: u,
  status: "STARTED",
  requestId: u4,
  supervisorId: u2,
  unitId: u2,
  adverseReactions: null,
  vitalSigns: null,
  request: { patientId: u },
};

// ---------------------------------------------------------------------------
// Helper: tenant con rol específico
// ---------------------------------------------------------------------------

function ctxWithRoles(prisma: Partial<PrismaClient>, roles: string[]) {
  return makeCtx({
    prisma,
    tenant: { ...MOCK_TENANT, roleCodes: roles },
  });
}

// ---------------------------------------------------------------------------
describe("bloodBankRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // withTenantContext llama $transaction internamente; lo mockeamos para
    // ejecutar el callback directamente sobre el mismo mock de prisma.
    prisma.$transaction.mockImplementation(async (fn) => {
      if (typeof fn === "function") return fn(prisma as unknown as PrismaClient);
      return fn;
    });
  });

  // =========================================================================
  describe("unit.list", () => {
    it("filtra por organizationId del tenant", async () => {
      prisma.bloodUnit.findMany.mockResolvedValue([] as never);
      const caller = bloodBankRouter.createCaller(makeCtx({ prisma }));
      await caller.unit.list({});
      const where = prisma.bloodUnit.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
      };
      expect(where.organizationId).toBe(ORG_ID);
    });

    it("filtra por bloodType cuando se especifica", async () => {
      prisma.bloodUnit.findMany.mockResolvedValue([] as never);
      const caller = bloodBankRouter.createCaller(makeCtx({ prisma }));
      await caller.unit.list({ bloodType: "A" });
      const where = prisma.bloodUnit.findMany.mock.calls[0]![0]!.where as {
        bloodType: string;
      };
      expect(where.bloodType).toBe("A");
    });

    it("respeta limit", async () => {
      prisma.bloodUnit.findMany.mockResolvedValue([] as never);
      const caller = bloodBankRouter.createCaller(makeCtx({ prisma }));
      await caller.unit.list({ limit: 10 });
      expect(prisma.bloodUnit.findMany.mock.calls[0]![0]!.take).toBe(10);
    });
  });

  // =========================================================================
  describe("unit.create", () => {
    const validInput = {
      bloodBankId: u,
      bloodType: "A" as const,
      rhFactor: "POSITIVE" as const,
      component: "RBC" as const,
      collectionDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-07-01"),
    };

    it("NOT_FOUND si bloodBank no es del tenant", async () => {
      prisma.bloodBank.findFirst.mockResolvedValue(null as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["LAB_TECHNICIAN"]),
      );
      await expect(caller.unit.create(validInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK crea la unidad con organizationId del tenant", async () => {
      prisma.bloodBank.findFirst.mockResolvedValue(BLOOD_BANK as never);
      prisma.bloodUnit.create.mockResolvedValue({ id: u2 } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["LAB_TECHNICIAN"]),
      );
      await caller.unit.create(validInput);
      const data = prisma.bloodUnit.create.mock.calls[0]![0]!.data as {
        organizationId: string;
        bloodType: string;
      };
      expect(data.organizationId).toBe(ORG_ID);
      expect(data.bloodType).toBe("A");
    });

    it("FORBIDDEN si usuario no tiene rol LAB_TECHNICIAN ni BLOOD_BANK_OFFICER", async () => {
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await expect(caller.unit.create(validInput)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  // =========================================================================
  describe("unit.discard", () => {
    it("NOT_FOUND si unidad no existe en tenant", async () => {
      prisma.bloodUnit.findFirst.mockResolvedValue(null as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["BLOOD_BANK_OFFICER"]),
      );
      await expect(
        caller.unit.discard({ id: u, discardReason: "Contaminada" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("PRECONDITION_FAILED si unidad ya está TRANSFUSED", async () => {
      prisma.bloodUnit.findFirst.mockResolvedValue({
        id: u,
        status: "TRANSFUSED",
      } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["BLOOD_BANK_OFFICER"]),
      );
      await expect(
        caller.unit.discard({ id: u, discardReason: "Contaminada" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("PRECONDITION_FAILED si unidad ya está DISCARDED", async () => {
      prisma.bloodUnit.findFirst.mockResolvedValue({
        id: u,
        status: "DISCARDED",
      } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["BLOOD_BANK_OFFICER"]),
      );
      await expect(
        caller.unit.discard({ id: u, discardReason: "duplicado" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("OK descarta la unidad y guarda discardReason", async () => {
      prisma.bloodUnit.findFirst.mockResolvedValue({
        id: u,
        status: "AVAILABLE",
      } as never);
      prisma.bloodUnit.update.mockResolvedValue({ id: u } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["LAB_TECHNICIAN"]),
      );
      await caller.unit.discard({ id: u, discardReason: "Caducada antes de tiempo" });
      const data = prisma.bloodUnit.update.mock.calls[0]![0]!.data as {
        status: string;
        discardReason: string;
      };
      expect(data.status).toBe("DISCARDED");
      expect(data.discardReason).toBe("Caducada antes de tiempo");
    });
  });

  // =========================================================================
  describe("request.create", () => {
    const validInput = {
      encounterId: u3,
      patientId: u,
      urgency: "URGENT" as const,
      component: "RBC" as const,
      unitsRequested: 2,
      clinicalIndication: "Anemia grave post-quirúrgica que requiere transfusión.",
    };

    it("NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["PHYSICIAN"]),
      );
      await expect(caller.request.create(validInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("BAD_REQUEST si patientId no coincide con encounter", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: u3,
        patientId: u2, // diferente
      } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["PHYSICIAN"]),
      );
      await expect(caller.request.create(validInput)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("OK crea solicitud con status=REQUESTED y organizationId del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(ENCOUNTER as never);
      prisma.transfusionRequest.create.mockResolvedValue({ id: u4 } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["PHYSICIAN"]),
      );
      await caller.request.create(validInput);
      const data = prisma.transfusionRequest.create.mock.calls[0]![0]!.data as {
        organizationId: string;
        urgency: string;
      };
      expect(data.organizationId).toBe(ORG_ID);
      expect(data.urgency).toBe("URGENT");
    });

    it("FORBIDDEN sin rol PHYSICIAN", async () => {
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await expect(caller.request.create(validInput)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  // =========================================================================
  describe("request.cancel", () => {
    it("NOT_FOUND si solicitud no existe o está en estado terminal", async () => {
      prisma.transfusionRequest.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["PHYSICIAN"]),
      );
      await expect(
        caller.request.cancel({ id: u4, cancelReason: "Ya no requerida" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("OK cancela solicitud abierta", async () => {
      prisma.transfusionRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["PHYSICIAN"]),
      );
      const r = await caller.request.cancel({ id: u4, cancelReason: "Paciente mejoró" });
      expect(r.ok).toBe(true);
    });

    it("status in-clause incluye REQUESTED, CROSSMATCHING, APPROVED", async () => {
      prisma.transfusionRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["PHYSICIAN"]),
      );
      await caller.request.cancel({ id: u4, cancelReason: "Cambio de plan" });
      const where = prisma.transfusionRequest.updateMany.mock.calls[0]![0]!.where as {
        status: { in: string[] };
      };
      expect(where.status.in).toContain("REQUESTED");
      expect(where.status.in).toContain("CROSSMATCHING");
      expect(where.status.in).toContain("APPROVED");
    });
  });

  // =========================================================================
  describe("crossMatch.perform", () => {
    const validInput = {
      requestId: u4,
      unitId: u2,
      result: "COMPATIBLE" as const,
      method: "Mayor (antiglobulina)",
    };

    it("NOT_FOUND si solicitud no existe o no está en estado abierto", async () => {
      prisma.transfusionRequest.findFirst.mockResolvedValue(null as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["LAB_TECHNICIAN"]),
      );
      await expect(caller.crossMatch.perform(validInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("NOT_FOUND si unidad no está disponible", async () => {
      prisma.transfusionRequest.findFirst.mockResolvedValue(
        TRANSFUSION_REQUEST_APPROVED as never,
      );
      prisma.bloodUnit.findFirst.mockResolvedValue(null as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["LAB_TECHNICIAN"]),
      );
      await expect(caller.crossMatch.perform(validInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK COMPATIBLE: avanza solicitud a APPROVED, no emite evento", async () => {
      prisma.transfusionRequest.findFirst.mockResolvedValue(
        TRANSFUSION_REQUEST_APPROVED as never,
      );
      prisma.bloodUnit.findFirst.mockResolvedValue(BLOOD_UNIT as never);
      prisma.crossMatch.create.mockResolvedValue({ id: u } as never);
      prisma.transfusionRequest.update.mockResolvedValue({} as never);
      prisma.domainEvent.create.mockResolvedValue({ id: u } as never);
      prisma.auditLog.create.mockResolvedValue({} as never);

      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["LAB_TECHNICIAN"]),
      );
      await caller.crossMatch.perform(validInput);

      const updateData = prisma.transfusionRequest.update.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(updateData.status).toBe("APPROVED");
      // COMPATIBLE no emite evento
      expect(prisma.domainEvent.create).not.toHaveBeenCalled();
    });

    it("OK INCOMPATIBLE: solicitud queda CROSSMATCHING y emite transfusion.crossmatchFailed", async () => {
      prisma.transfusionRequest.findFirst.mockResolvedValue(
        TRANSFUSION_REQUEST_APPROVED as never,
      );
      prisma.bloodUnit.findFirst.mockResolvedValue(BLOOD_UNIT as never);
      prisma.crossMatch.create.mockResolvedValue({ id: u } as never);
      prisma.transfusionRequest.update.mockResolvedValue({} as never);
      prisma.domainEvent.create.mockResolvedValue({ id: u } as never);
      prisma.auditLog.create.mockResolvedValue({} as never);

      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["LAB_TECHNICIAN"]),
      );
      await caller.crossMatch.perform({
        ...validInput,
        result: "INCOMPATIBLE",
      });

      const updateData = prisma.transfusionRequest.update.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(updateData.status).toBe("CROSSMATCHING");
      expect(prisma.domainEvent.create).toHaveBeenCalledOnce();
      const eventData = prisma.domainEvent.create.mock.calls[0]![0]!.data as {
        eventType: string;
      };
      expect(eventData.eventType).toBe("transfusion.crossmatchFailed");
    });

    it("OK INCONCLUSIVE también emite evento", async () => {
      prisma.transfusionRequest.findFirst.mockResolvedValue(
        TRANSFUSION_REQUEST_APPROVED as never,
      );
      prisma.bloodUnit.findFirst.mockResolvedValue(BLOOD_UNIT as never);
      prisma.crossMatch.create.mockResolvedValue({ id: u } as never);
      prisma.transfusionRequest.update.mockResolvedValue({} as never);
      prisma.domainEvent.create.mockResolvedValue({ id: u } as never);
      prisma.auditLog.create.mockResolvedValue({} as never);

      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["LAB_TECHNICIAN"]),
      );
      await caller.crossMatch.perform({ ...validInput, result: "INCONCLUSIVE" });

      expect(prisma.domainEvent.create).toHaveBeenCalledOnce();
    });

    it("FORBIDDEN sin rol LAB_TECHNICIAN ni BLOOD_BANK_OFFICER", async () => {
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["PHYSICIAN"]),
      );
      await expect(
        caller.crossMatch.perform(validInput),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // =========================================================================
  describe("transfusion.start", () => {
    // Router added IPSG.1 ME3 two-identifier verification (patientGsrn + secondIdentifier)
    const validInput = {
      requestId: u4,
      unitId: u2,
      crossMatchId: u,
      supervisorId: u3,
      route: "IV_PERIPHERAL" as const,
      patientGsrn: "1234567890123",
      secondIdentifier: "MRN-001",
    };

    // Patient fixture for 2-ID verification mock
    const PATIENT_FOR_TRANSFUSION = {
      id: u,
      mrn: "MRN-001",
      identifiers: [],
    };

    it("NOT_FOUND si request no está APPROVED", async () => {
      prisma.transfusionRequest.findFirst.mockResolvedValue(null as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await expect(caller.transfusion.start(validInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("PRECONDITION_FAILED si crossmatch COMPATIBLE no existe para el trio request/unit/crossMatchId", async () => {
      prisma.transfusionRequest.findFirst.mockResolvedValue(
        TRANSFUSION_REQUEST_APPROVED as never,
      );
      // 2-ID verification: patient found with correct GSRN
      prisma.patient.findFirst.mockResolvedValue(PATIENT_FOR_TRANSFUSION as never);
      prisma.crossMatch.findFirst.mockResolvedValue(null as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await expect(caller.transfusion.start(validInput)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("OK inicia transfusión y avanza request a FULFILLED", async () => {
      prisma.transfusionRequest.findFirst.mockResolvedValue(
        TRANSFUSION_REQUEST_APPROVED as never,
      );
      // 2-ID verification: patient found
      prisma.patient.findFirst.mockResolvedValue(PATIENT_FOR_TRANSFUSION as never);
      prisma.crossMatch.findFirst.mockResolvedValue(
        CROSS_MATCH_COMPATIBLE as never,
      );
      prisma.bloodUnit.update.mockResolvedValue({} as never);
      prisma.transfusion.create.mockResolvedValue({ id: u } as never);
      prisma.transfusionRequest.update.mockResolvedValue({} as never);

      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      const result = await caller.transfusion.start(validInput);
      expect(result).toBeDefined();

      const unitUpdateData = prisma.bloodUnit.update.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(unitUpdateData.status).toBe("IN_USE");

      const requestUpdateData = prisma.transfusionRequest.update.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(requestUpdateData.status).toBe("FULFILLED");
    });

    it("FORBIDDEN sin rol NURSE", async () => {
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["LAB_TECHNICIAN"]),
      );
      await expect(caller.transfusion.start(validInput)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  // =========================================================================
  describe("transfusion.complete", () => {
    it("NOT_FOUND si transfusión no existe", async () => {
      prisma.transfusion.findFirst.mockResolvedValue(null as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await expect(caller.transfusion.complete({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK completa y marca unidad TRANSFUSED", async () => {
      prisma.transfusion.findFirst.mockResolvedValue(TRANSFUSION_STARTED as never);
      prisma.transfusion.update.mockResolvedValue({ id: u, status: "COMPLETED" } as never);
      prisma.bloodUnit.update.mockResolvedValue({} as never);

      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await caller.transfusion.complete({ id: u });

      const transfUpdateData = prisma.transfusion.update.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(transfUpdateData.status).toBe("COMPLETED");

      const unitUpdateData = prisma.bloodUnit.update.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(unitUpdateData.status).toBe("TRANSFUSED");
    });

    it("OK ABORTED devuelve unidad a AVAILABLE", async () => {
      prisma.transfusion.findFirst.mockResolvedValue(TRANSFUSION_STARTED as never);
      prisma.transfusion.update.mockResolvedValue({ id: u, status: "ABORTED" } as never);
      prisma.bloodUnit.update.mockResolvedValue({} as never);

      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await caller.transfusion.complete({ id: u, abortReason: "Reacción inicial controlada" });

      const unitUpdateData = prisma.bloodUnit.update.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(unitUpdateData.status).toBe("AVAILABLE");
    });
  });

  // =========================================================================
  describe("transfusion.recordReaction", () => {
    const validInput = {
      id: u,
      reactionType: "Urticaria",
      severity: "MILD" as const,
      management: "Antihistamínico IV, monitoreo continuo.",
    };

    it("NOT_FOUND si transfusión no existe", async () => {
      prisma.transfusion.findFirst.mockResolvedValue(null as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await expect(caller.transfusion.recordReaction(validInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("PRECONDITION_FAILED si transfusión ya está COMPLETED", async () => {
      prisma.transfusion.findFirst.mockResolvedValue({
        ...TRANSFUSION_STARTED,
        status: "COMPLETED",
      } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await expect(caller.transfusion.recordReaction(validInput)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("OK MILD: registra reacción sin emitir evento de dominio", async () => {
      prisma.transfusion.findFirst.mockResolvedValue(TRANSFUSION_STARTED as never);
      prisma.transfusion.update.mockResolvedValue({ id: u } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: u } as never);
      prisma.auditLog.create.mockResolvedValue({} as never);

      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await caller.transfusion.recordReaction(validInput);

      // MILD no emite evento
      expect(prisma.domainEvent.create).not.toHaveBeenCalled();
      expect(prisma.transfusion.update).toHaveBeenCalledOnce();
    });

    it("OK SEVERE: registra reacción y emite transfusion.adverseReaction", async () => {
      prisma.transfusion.findFirst.mockResolvedValue(TRANSFUSION_STARTED as never);
      prisma.transfusion.update.mockResolvedValue({ id: u } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: u } as never);
      prisma.auditLog.create.mockResolvedValue({} as never);

      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await caller.transfusion.recordReaction({
        ...validInput,
        severity: "SEVERE",
      });

      expect(prisma.domainEvent.create).toHaveBeenCalledOnce();
      const eventData = prisma.domainEvent.create.mock.calls[0]![0]!.data as {
        eventType: string;
      };
      expect(eventData.eventType).toBe("transfusion.adverseReaction");
    });

    it("OK LIFE_THREATENING también emite evento", async () => {
      prisma.transfusion.findFirst.mockResolvedValue(TRANSFUSION_STARTED as never);
      prisma.transfusion.update.mockResolvedValue({ id: u } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: u } as never);
      prisma.auditLog.create.mockResolvedValue({} as never);

      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await caller.transfusion.recordReaction({
        ...validInput,
        severity: "LIFE_THREATENING",
      });

      expect(prisma.domainEvent.create).toHaveBeenCalledOnce();
    });

    it("OK MODERATE no emite evento", async () => {
      prisma.transfusion.findFirst.mockResolvedValue(TRANSFUSION_STARTED as never);
      prisma.transfusion.update.mockResolvedValue({ id: u } as never);

      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["NURSE"]),
      );
      await caller.transfusion.recordReaction({
        ...validInput,
        severity: "MODERATE",
      });

      expect(prisma.domainEvent.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  describe("tenant isolation", () => {
    it("unit.list siempre inyecta el organizationId del tenant, no del input", async () => {
      prisma.bloodUnit.findMany.mockResolvedValue([] as never);
      const caller = bloodBankRouter.createCaller(makeCtx({ prisma }));
      await caller.unit.list({ bloodBankId: u3 });
      const where = prisma.bloodUnit.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
      };
      // organizationId del tenant, no del bloodBankId del input
      expect(where.organizationId).toBe(ORG_ID);
    });

    it("request.create inyecta organizationId del tenant en la data", async () => {
      prisma.encounter.findFirst.mockResolvedValue(ENCOUNTER as never);
      prisma.transfusionRequest.create.mockResolvedValue({ id: u4 } as never);
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["PHYSICIAN"]),
      );
      await caller.request.create({
        encounterId: u3,
        patientId: u,
        component: "PLT",
        clinicalIndication: "Trombocitopenia severa post-quimioterapia grave.",
      });
      const data = prisma.transfusionRequest.create.mock.calls[0]![0]!.data as {
        organizationId: string;
      };
      expect(data.organizationId).toBe(ORG_ID);
    });
  });

  // =========================================================================
  describe("Zod input validation", () => {
    it("clinicalIndication requiere mínimo 10 chars", async () => {
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["PHYSICIAN"]),
      );
      await expect(
        caller.request.create({
          encounterId: u3,
          patientId: u,
          component: "RBC",
          clinicalIndication: "corto", // < 10 chars
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("discardReason requiere mínimo 5 chars", async () => {
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["LAB_TECHNICIAN"]),
      );
      await expect(
        caller.unit.discard({ id: u, discardReason: "ok" }), // < 5 chars
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("unitsRequested debe ser >= 1", async () => {
      const caller = bloodBankRouter.createCaller(
        ctxWithRoles({ ...prisma }, ["PHYSICIAN"]),
      );
      await expect(
        caller.request.create({
          encounterId: u3,
          patientId: u,
          component: "RBC",
          clinicalIndication: "Indicación válida suficiente.",
          unitsRequested: 0,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
