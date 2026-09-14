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
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const from = new Date("2026-01-01");
const to = new Date("2027-01-01");

describe("insuranceRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // R02: todos los procedures ahora pasan por withTenantContext (SET LOCAL +
    // $transaction). tx === prisma, así que las assertions sobre
    // prisma.<model>.<método> siguen funcionando sin cambios.
    installTenantContextMock(prisma);
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
      // CC-0028c: el where pasó a `{ AND: filters }` (mismo patrón que insurer.list).
      const and = (prisma.patientCoverage.findMany.mock.calls[0]![0]!.where as {
        AND: Array<{ organizationId?: string }>;
      }).AND;
      const tenancyFilter = and.find((c) => c.organizationId !== undefined);
      expect(tenancyFilter?.organizationId).toBeTruthy();
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

    // -----------------------------------------------------------------------
    // CC-0028c — filtros nuevos de coverage.list (mantenimiento admin)
    // -----------------------------------------------------------------------

    it("list compone search (policyNumber/paciente) en AND, no sobreescribe tenancy", async () => {
      prisma.patientCoverage.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.coverage.list({ activeOnly: true, search: "gonzalez", limit: 20 });
      const and = (prisma.patientCoverage.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      expect(and.some((c) => "organizationId" in c)).toBe(true);
      expect(and.some((c) => "OR" in c)).toBe(true);
    });

    it("list filtra por insurerId vía plan.insurerId", async () => {
      prisma.patientCoverage.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.coverage.list({ activeOnly: true, insurerId: u, limit: 20 });
      const and = (prisma.patientCoverage.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      expect(and).toContainEqual({ plan: { insurerId: u } });
    });

    it("list filtra por vigentesA: validFrom<=X y (validTo null o >=X)", async () => {
      prisma.patientCoverage.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.coverage.list({ activeOnly: false, vigentesA: from, limit: 20 });
      const and = (prisma.patientCoverage.findMany.mock.calls[0]![0]!.where as {
        AND: Array<{ validFrom?: { lte: Date }; OR?: object[] }>;
      }).AND;
      const vigenciaFilter = and.find((c) => c.validFrom !== undefined);
      expect(vigenciaFilter?.validFrom).toEqual({ lte: from });
      expect(vigenciaFilter?.OR).toEqual([{ validTo: null }, { validTo: { gte: from } }]);
    });

    it("list respeta offset además de limit", async () => {
      prisma.patientCoverage.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.coverage.list({ activeOnly: true, limit: 20, offset: 40 });
      const call = prisma.patientCoverage.findMany.mock.calls[0]![0]!;
      expect(call.take).toBe(20);
      expect(call.skip).toBe(40);
    });
  });

  // -------------------------------------------------------------------------
  describe("coverage.update", () => {
    it("NOT_FOUND si la póliza no es del tenant", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.coverage.update({ id: u, policyNumber: "NUEVA" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("OK: edita policyNumber/carnet manteniendo vigencia existente", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({
        validFrom: from,
        validTo: to,
      } as never);
      prisma.patientCoverage.update.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.coverage.update({ id: u, policyNumber: "POL-EDITADA", carnet: "C-99" });
      const call = prisma.patientCoverage.update.mock.calls[0]![0]!;
      expect(call.where).toEqual({ id: u });
      const data = call.data as { policyNumber: string; carnet: string; updatedBy: string };
      expect(data.policyNumber).toBe("POL-EDITADA");
      expect(data.carnet).toBe("C-99");
      expect(data.updatedBy).toBeTruthy();
    });

    it("no permite cambiar patientId aunque el caller lo envíe (campo fuera de schema)", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({
        validFrom: from,
        validTo: null,
      } as never);
      prisma.patientCoverage.update.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      // Simula un caller no tipado (p. ej. JSON crudo) intentando colar patientId.
      await caller.coverage.update({ id: u, policyNumber: "X", ...( { patientId: "otro-paciente" } as object) });
      const data = prisma.patientCoverage.update.mock.calls[0]![0]!.data as Record<string, unknown>;
      expect(data.patientId).toBeUndefined();
    });

    it("BAD_REQUEST si el nuevo validTo no es posterior al validFrom existente", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({
        validFrom: from,
        validTo: null,
      } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const antesDeFrom = new Date("2025-01-01");
      await expect(
        caller.coverage.update({ id: u, validTo: antesDeFrom }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("BAD_REQUEST si el nuevo validFrom supera el validTo existente", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({
        validFrom: from,
        validTo: to,
      } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const despuesDeTo = new Date("2028-01-01");
      await expect(
        caller.coverage.update({ id: u, validFrom: despuesDeTo }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("NOT_FOUND si el nuevo planId no es visible para el tenant", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({
        validFrom: from,
        validTo: null,
      } as never);
      prisma.insurancePlan.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.coverage.update({ id: u, planId: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("NOT_FOUND si priceListId no pertenece al tenant (assertPriceListVisible)", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({
        validFrom: from,
        validTo: null,
      } as never);
      prisma.$queryRawUnsafe.mockResolvedValue([] as never); // ServicePriceList: sin filas
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.coverage.update({ id: u, priceListId: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("OK: priceListId visible se guarda", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({
        validFrom: from,
        validTo: null,
      } as never);
      prisma.$queryRawUnsafe.mockResolvedValue([{ id: u }] as never); // ServicePriceList del tenant
      prisma.patientCoverage.update.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.coverage.update({ id: u, priceListId: u });
      const data = prisma.patientCoverage.update.mock.calls[0]![0]!.data as { priceListId: string };
      expect(data.priceListId).toBe(u);
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

  // ---------------------------------------------------------------------------
  // CC-0028 — planCoverage / coverageOverride / rule
  // ---------------------------------------------------------------------------

  describe("planCoverage.upsert", () => {
    it("NOT_FOUND si el plan no es visible para el tenant", async () => {
      prisma.insurancePlan.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.planCoverage.upsert({ planId: u, ambito: "CONSULTA", coverageType: "PORCENTAJE", insuredPercentage: 80 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("upsert por (planId, ambito) cuando el plan es visible", async () => {
      prisma.insurancePlan.findFirst.mockResolvedValue({ id: u } as never);
      prisma.insurancePlanCoverage.upsert.mockResolvedValue({ id: "cov-1" } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.planCoverage.upsert({
        planId: u,
        ambito: "FARMACIA",
        coverageType: "MONTO_FIJO",
        copayAmount: 5,
      });
      const args = prisma.insurancePlanCoverage.upsert.mock.calls[0]![0]!;
      expect(args.where).toEqual({ planId_ambito: { planId: u, ambito: "FARMACIA" } });
      expect(args.create).toMatchObject({ planId: u, ambito: "FARMACIA", coverageType: "MONTO_FIJO", copayAmount: 5 });
    });
  });

  describe("planCoverage.list", () => {
    it("filtra por planId", async () => {
      prisma.insurancePlanCoverage.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.planCoverage.list({ planId: u });
      expect(prisma.insurancePlanCoverage.findMany.mock.calls[0]![0]!.where).toEqual({ planId: u });
    });
  });

  describe("coverageOverride.upsert", () => {
    it("NOT_FOUND si la póliza no existe en la organización", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.coverageOverride.upsert({
          coverageId: u,
          ambito: "CONSULTA",
          coverageType: "PORCENTAJE",
          insuredPercentage: 100,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("upsert por (coverageId, ambito) cuando la póliza es del tenant", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue({ id: u } as never);
      prisma.patientCoverageOverride.upsert.mockResolvedValue({ id: "ov-1" } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.coverageOverride.upsert({
        coverageId: u,
        ambito: "CONSULTA",
        coverageType: "PORCENTAJE",
        insuredPercentage: 100,
      });
      const args = prisma.patientCoverageOverride.upsert.mock.calls[0]![0]!;
      expect(args.where).toEqual({ coverageId_ambito: { coverageId: u, ambito: "CONSULTA" } });
    });
  });

  describe("rule.create", () => {
    it("NOT_FOUND si planId no es visible para el tenant", async () => {
      prisma.insurancePlan.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.rule.create({ planId: u, ruleOn: "CODIGO", code: "X", ruleType: "PORCENTAJE", percentage: 50 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("NOT_FOUND si coverageId no existe en la organización", async () => {
      prisma.patientCoverage.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.rule.create({ coverageId: u, ruleOn: "CODIGO", code: "X", ruleType: "PORCENTAJE", percentage: 50 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea la regla con organizationId del tenant cuando el plan es visible", async () => {
      prisma.insurancePlan.findFirst.mockResolvedValue({ id: u } as never);
      prisma.coverageRule.create.mockResolvedValue({ id: "rule-1" } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.rule.create({ planId: u, ruleOn: "CODIGO", code: "X", ruleType: "PORCENTAJE", percentage: 90 });
      const data = prisma.coverageRule.create.mock.calls[0]![0]!.data as { organizationId: string; planId: string };
      expect(data.organizationId).toBeTruthy();
      expect(data.planId).toBe(u);
    });
  });

  describe("rule.deactivate", () => {
    it("NOT_FOUND si la regla no existe o ya está inactiva", async () => {
      prisma.coverageRule.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.rule.deactivate({ id: u })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("desactiva la regla del tenant", async () => {
      prisma.coverageRule.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.rule.deactivate({ id: u });
      expect(result).toEqual({ ok: true });
    });
  });
});
