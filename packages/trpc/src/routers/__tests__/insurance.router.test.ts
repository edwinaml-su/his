/**
 * Tests del insuranceRouter (§25 — Wave 8 Beta.14 hardening layer 1).
 *
 * Cubre:
 *   - Catálogo global + tenant via AND-compose (sin bug de OR sobreescrito).
 *   - Tenant-isolation directo en coverage/authorization.
 *   - State machine PENDING -> APPROVED | DENIED (b14).
 *   - approve: requiere validUntil para APPROVED (b14).
 *   - deny: OPEN_STATES (PENDING + REQUESTED) habilitados (b14).
 *   - getExpiring: filtra APPROVED con validTo dentro del horizonte (b14).
 *   - checkCoverage: parsea coveredProcedures JSONB (b14).
 *   - plan.create: acepta coveredProcedures (b14).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { insuranceRouter } from "../insurance.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const from = new Date("2026-01-01");
const to = new Date("2027-01-01");

describe("insuranceRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // -------------------------------------------------------------------------
  describe("insurer.list", () => {
    it("incluye catálogo global + tenant cuando no hay search", async () => {
      prisma.insurer.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.insurer.list({ activeOnly: true, limit: 50 });
      const args = prisma.insurer.findMany.mock.calls[0]![0];
      const and = (args!.where as { AND: object[] }).AND;
      expect(and.some((c) => "OR" in c)).toBe(true);
    });

    it("compone search en AND, no sobreescribe tenancy", async () => {
      prisma.insurer.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.insurer.list({ activeOnly: true, search: "isss", limit: 20 });
      const and = (prisma.insurer.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      const orsCount = and.filter((c) => "OR" in c).length;
      expect(orsCount).toBeGreaterThanOrEqual(2);
    });

    it("respeta limit", async () => {
      prisma.insurer.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.insurer.list({ activeOnly: true, limit: 12 });
      expect(prisma.insurer.findMany.mock.calls[0]![0]!.take).toBe(12);
    });
  });

  describe("insurer.create", () => {
    it("asigna organizationId del tenant cuando no se especifica", async () => {
      prisma.insurer.create.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.insurer.create({ code: "X", name: "X" });
      const data = prisma.insurer.create.mock.calls[0]![0]!.data as {
        organizationId: string | null;
      };
      expect(data.organizationId).toBeTruthy();
    });

    it("respeta organizationId=null (catálogo global)", async () => {
      prisma.insurer.create.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.insurer.create({
        organizationId: null,
        code: "PUB",
        name: "Pub",
        kind: "PUBLIC",
      });
      const data = prisma.insurer.create.mock.calls[0]![0]!.data as {
        organizationId: string | null;
      };
      expect(data.organizationId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("plan.create", () => {
    it("NOT_FOUND si insurer no es visible para tenant", async () => {
      prisma.insurer.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.plan.create({ insurerId: u, code: "PA", name: "Plan A" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("OK crea plan", async () => {
      prisma.insurer.findFirst.mockResolvedValue({ id: u } as never);
      prisma.insurancePlan.create.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.plan.create({ insurerId: u, code: "PB", name: "Plan B" });
      expect(r.id).toBe(u);
    });

    it("b14: pasa coveredProcedures al modelo", async () => {
      prisma.insurer.findFirst.mockResolvedValue({ id: u } as never);
      prisma.insurancePlan.create.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.plan.create({
        insurerId: u,
        code: "PC",
        name: "Plan C",
        coveredProcedures: [{ code: "MRI", maxCoverage: 1500 }],
      });
      const data = prisma.insurancePlan.create.mock.calls[0]![0]!.data as {
        coveredProcedures: unknown;
      };
      expect(Array.isArray(data.coveredProcedures)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("coverage.list / create / deactivate", () => {
    it("list filtra por organizationId", async () => {
      prisma.patientCoverage.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.coverage.list({ activeOnly: true, limit: 50 });
      const where = prisma.patientCoverage.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
      };
      expect(where.organizationId).toBeTruthy();
    });

    it("create NOT_FOUND si paciente no pertenece al tenant", async () => {
      prisma.patient.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.coverage.create({
          patientId: u,
          planId: u,
          policyNumber: "POL",
          validFrom: from,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create NOT_FOUND si plan no es visible", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: u } as never);
      prisma.insurancePlan.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.coverage.create({
          patientId: u,
          planId: u,
          policyNumber: "POL",
          validFrom: from,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK con validTo", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: u } as never);
      prisma.insurancePlan.findFirst.mockResolvedValue({ id: u } as never);
      prisma.patientCoverage.create.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.coverage.create({
        patientId: u,
        planId: u,
        policyNumber: "POL-1",
        validFrom: from,
        validTo: to,
      });
      const data = prisma.patientCoverage.create.mock.calls[0]![0]!.data;
      expect((data as { organizationId: string }).organizationId).toBeTruthy();
      expect((data as { createdBy: string }).createdBy).toBeTruthy();
    });

    it("deactivate NOT_FOUND si ya inactiva", async () => {
      prisma.patientCoverage.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.coverage.deactivate({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("deactivate OK setea active=false", async () => {
      prisma.patientCoverage.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.coverage.deactivate({ id: u });
      expect(r.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("authorization.create / approve / deny", () => {
    it("create NOT_FOUND si coverage no es del tenant", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.authorization.create({
          coverageId: u,
          serviceCode: "MRI",
          serviceDesc: "Resonancia",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create con encounterId valida también el encounter", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({ id: u } as never);
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.authorization.create({
          coverageId: u,
          encounterId: u,
          serviceCode: "X",
          serviceDesc: "x",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("b14: create guarda status=PENDING", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({ id: u } as never);
      prisma.authorizationRequest.create.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.authorization.create({
        coverageId: u,
        serviceCode: "X",
        serviceDesc: "x",
      });
      const data = prisma.authorizationRequest.create.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(data.status).toBe("PENDING");
    });

    it("b14: approve setea APPROVED + validTo cuando partial=false y validUntil presente", async () => {
      prisma.authorizationRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.authorization.approve({
        id: u,
        externalRef: "AUTH-123",
        validUntil: to,
      });
      const call = prisma.authorizationRequest.updateMany.mock.calls[0]![0]!;
      const data = call.data as { status: string; validTo: Date };
      expect(data.status).toBe("APPROVED");
      expect(data.validTo).toEqual(to);
    });

    it("b14: approve BAD_REQUEST si APPROVED sin validUntil", async () => {
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.authorization.approve({
          id: u,
          externalRef: "AUTH-123",
          // no validUntil, no validTo
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("b14: approve PARTIAL no requiere validUntil", async () => {
      prisma.authorizationRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.authorization.approve({
        id: u,
        externalRef: "AUTH-123",
        partial: true,
        approvedAmount: 250,
      });
      const data = prisma.authorizationRequest.updateMany.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(data.status).toBe("PARTIAL");
    });

    it("b14: approve acepta PENDING en where.status", async () => {
      prisma.authorizationRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.authorization.approve({
        id: u,
        externalRef: "AUTH-123",
        validUntil: to,
      });
      const where = prisma.authorizationRequest.updateMany.mock.calls[0]![0]!.where as {
        status: { in: string[] };
      };
      expect(where.status.in).toContain("PENDING");
      expect(where.status.in).toContain("REQUESTED");
    });

    it("b14: approve NOT_FOUND si no está en OPEN_STATES", async () => {
      prisma.authorizationRequest.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.authorization.approve({ id: u, externalRef: "X", validUntil: to }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("b14: deny acepta PENDING en where.status", async () => {
      prisma.authorizationRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.authorization.deny({ id: u, denialReason: "Fuera de cobertura" });
      const where = prisma.authorizationRequest.updateMany.mock.calls[0]![0]!.where as {
        status: { in: string[] };
      };
      expect(where.status.in).toContain("PENDING");
      expect(where.status.in).toContain("REQUESTED");
    });

    it("deny guarda denialReason", async () => {
      prisma.authorizationRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.authorization.deny({ id: u, denialReason: "Fuera de cobertura" });
      const data = prisma.authorizationRequest.updateMany.mock.calls[0]![0]!.data as {
        status: string;
        denialReason: string;
      };
      expect(data.status).toBe("DENIED");
      expect(data.denialReason).toBe("Fuera de cobertura");
    });

    it("deny NOT_FOUND si no está en OPEN_STATES", async () => {
      prisma.authorizationRequest.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.authorization.deny({ id: u, denialReason: "Razón" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("get NOT_FOUND si no existe", async () => {
      prisma.authorizationRequest.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.authorization.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("b14: authorization.getExpiring", () => {
    it("filtra por status=APPROVED y validTo <= cutoff", async () => {
      prisma.authorizationRequest.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.authorization.getExpiring({ daysAhead: 7, limit: 50 });
      const where = prisma.authorizationRequest.findMany.mock.calls[0]![0]!.where as {
        status: string;
        validTo: { lte: Date };
      };
      expect(where.status).toBe("APPROVED");
      expect(where.validTo.lte).toBeInstanceOf(Date);
    });

    it("cutoff = now + daysAhead días", async () => {
      prisma.authorizationRequest.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const before = new Date();
      await caller.authorization.getExpiring({ daysAhead: 14, limit: 10 });
      const after = new Date();
      const where = prisma.authorizationRequest.findMany.mock.calls[0]![0]!.where as {
        validTo: { lte: Date };
      };
      const cutoff = where.validTo.lte;
      const expectedMin = new Date(before);
      expectedMin.setDate(expectedMin.getDate() + 14);
      const expectedMax = new Date(after);
      expectedMax.setDate(expectedMax.getDate() + 14);
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime() - 1000);
      expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMax.getTime() + 1000);
    });

    it("respeta limit", async () => {
      prisma.authorizationRequest.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.authorization.getExpiring({ daysAhead: 7, limit: 5 });
      expect(prisma.authorizationRequest.findMany.mock.calls[0]![0]!.take).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  describe("b14: checkCoverage", () => {
    it("covered=true + maxCoverage cuando procedureCode está en JSONB", async () => {
      prisma.insurancePlan.findFirst.mockResolvedValue({
        id: u,
        coveredProcedures: [{ code: "MRI", maxCoverage: 1500 }],
      } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.checkCoverage({ planId: u, procedureCode: "MRI" });
      expect(result.covered).toBe(true);
      expect(result.maxCoverage).toBe(1500);
      expect(result.procedureCode).toBe("MRI");
    });

    it("case-insensitive matching en procedureCode", async () => {
      prisma.insurancePlan.findFirst.mockResolvedValue({
        id: u,
        coveredProcedures: [{ code: "mri", maxCoverage: 900 }],
      } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.checkCoverage({ planId: u, procedureCode: "MRI" });
      expect(result.covered).toBe(true);
      expect(result.maxCoverage).toBe(900);
    });

    it("covered=false cuando procedureCode no está", async () => {
      prisma.insurancePlan.findFirst.mockResolvedValue({
        id: u,
        coveredProcedures: [{ code: "LAB" }],
      } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.checkCoverage({ planId: u, procedureCode: "MRI" });
      expect(result.covered).toBe(false);
      expect(result.maxCoverage).toBeNull();
    });

    it("covered=false cuando coveredProcedures es null", async () => {
      prisma.insurancePlan.findFirst.mockResolvedValue({
        id: u,
        coveredProcedures: null,
      } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.checkCoverage({ planId: u, procedureCode: "MRI" });
      expect(result.covered).toBe(false);
    });

    it("maxCoverage=null cuando procedimiento no tiene límite monetario", async () => {
      prisma.insurancePlan.findFirst.mockResolvedValue({
        id: u,
        coveredProcedures: [{ code: "LAB-CBC" }],
      } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.checkCoverage({ planId: u, procedureCode: "LAB-CBC" });
      expect(result.covered).toBe(true);
      expect(result.maxCoverage).toBeNull();
    });

    it("NOT_FOUND si plan no existe o no es visible", async () => {
      prisma.insurancePlan.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.checkCoverage({ planId: u, procedureCode: "MRI" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
