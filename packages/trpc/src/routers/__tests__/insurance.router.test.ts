/**
 * Tests del insuranceRouter (§25 — Wave 8 Phase 2 skeleton).
 *
 * Cubre:
 *   - Catálogo global + tenant via AND-compose (sin bug de OR sobreescrito).
 *   - Tenant-isolation directo en coverage/authorization.
 *   - Workflow request → approve | partial | deny.
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
      // El AND debe incluir el OR de tenancy.
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
      // Debe haber AL MENOS dos cláusulas con OR: la de tenancy y la de search.
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

    it("create OK", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({ id: u } as never);
      prisma.authorizationRequest.create.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.authorization.create({
        coverageId: u,
        serviceCode: "X",
        serviceDesc: "x",
      });
      expect(r.id).toBe(u);
    });

    it("approve setea APPROVED cuando partial=false", async () => {
      prisma.authorizationRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.authorization.approve({
        id: u,
        externalRef: "AUTH-123",
      });
      const data = prisma.authorizationRequest.updateMany.mock.calls[0]![0]!.data;
      expect((data as { status: string }).status).toBe("APPROVED");
    });

    it("approve setea PARTIAL cuando partial=true", async () => {
      prisma.authorizationRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.authorization.approve({
        id: u,
        externalRef: "AUTH-123",
        partial: true,
        approvedAmount: 250,
      });
      const data = prisma.authorizationRequest.updateMany.mock.calls[0]![0]!.data;
      expect((data as { status: string }).status).toBe("PARTIAL");
    });

    it("approve NOT_FOUND si no está REQUESTED", async () => {
      prisma.authorizationRequest.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.authorization.approve({ id: u, externalRef: "X" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
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

    it("get NOT_FOUND si no existe", async () => {
      prisma.authorizationRequest.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.authorization.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
