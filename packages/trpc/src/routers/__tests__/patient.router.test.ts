/**
 * Tests de integración del patient router.
 * Mock: PrismaClient (vitest-mock-extended) + TenantContext.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { patientRouter } from "../patient.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN, VALID_DUIS, INVALID_DUIS } from "@his/test-utils";

describe("patientRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  /**
   * Tras H1-06 (S0 Tier 1), `search` y `get` se ejecutan dentro de
   * `withTenantContext` → `prisma.$transaction(callback)`. El mock ejecuta
   * el callback con el propio `prisma` como `tx`, manteniendo los delegados
   * accesibles desde mock.calls.
   */
  function setupTx() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void }).mockImplementation(
      async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma),
    );
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("search", () => {
    it("filtra por organizationId del tenant y excluye eliminados", async () => {
      setupTx();
      prisma.patient.findMany.mockResolvedValue([] as never);
      const caller = patientRouter.createCaller(makeCtx({ prisma }));

      await caller.search({ query: "María" });

      const args = prisma.patient.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        deletedAt: null,
      });
      expect(args.take).toBe(20);
    });

    it("rechaza query vacío (Zod)", async () => {
      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.search({ query: "" })).rejects.toThrow();
    });

    it("RLS — la query corre dentro de $transaction + SET LOCAL ROLE", async () => {
      setupTx();
      prisma.patient.findMany.mockResolvedValue([] as never);
      const caller = patientRouter.createCaller(makeCtx({ prisma }));

      await caller.search({ query: "María" });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const calls = prisma.$executeRawUnsafe.mock.calls.map((c) => String(c[0]));
      expect(calls.some((s) => s.includes("set_tenant_context"))).toBe(true);
      expect(calls.some((s) => s.includes("SET LOCAL ROLE authenticated"))).toBe(true);
    });
  });

  describe("get", () => {
    it("lanza NOT_FOUND si no existe", async () => {
      setupTx();
      prisma.patient.findFirst.mockResolvedValue(null);
      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.get({ id: MOCK_USER_ADMIN.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("retorna paciente con relaciones cuando existe", async () => {
      setupTx();
      const fake = {
        id: MOCK_USER_ADMIN.id,
        firstName: "Ana",
        biologicalSexId: "00000000-0000-0000-0000-000000000001",
        genderId: null,
        maritalStatusId: null,
      };
      prisma.patient.findFirst.mockResolvedValue(fake as never);
      // Mock de las 9 sub-queries paralelas (post-refactor a resilient includes).
      prisma.patientIdentifier.findMany.mockResolvedValue([] as never);
      prisma.patientAddress.findMany.mockResolvedValue([] as never);
      prisma.patientPhone.findMany.mockResolvedValue([] as never);
      prisma.patientEmail.findMany.mockResolvedValue([] as never);
      prisma.patientEmergencyContact.findMany.mockResolvedValue([] as never);
      prisma.patientAllergy.findMany.mockResolvedValue([] as never);
      prisma.biologicalSex.findUnique.mockResolvedValue(null as never);
      prisma.gender.findUnique.mockResolvedValue(null as never);
      prisma.maritalStatus.findUnique.mockResolvedValue(null as never);

      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.get({ id: MOCK_USER_ADMIN.id });
      // El shape ahora es: paciente base + relaciones embed (todas vacías en test).
      expect(out).toMatchObject({
        ...fake,
        identifiers: [],
        addresses: [],
        phones: [],
        emails: [],
        emergencyContacts: [],
        allergies: [],
        biologicalSex: null,
        gender: null,
        maritalStatus: null,
      });
    });

    it("resiliente: si un include lanza, devuelve fallback (no tumba la query)", async () => {
      setupTx();
      const fake = {
        id: MOCK_USER_ADMIN.id,
        firstName: "Ana",
        biologicalSexId: "00000000-0000-0000-0000-000000000001",
        genderId: null,
        maritalStatusId: null,
      };
      prisma.patient.findFirst.mockResolvedValue(fake as never);
      // Simulamos schema drift: la query de identifiers lanza 42P01.
      prisma.patientIdentifier.findMany.mockRejectedValue(
        new Error('relation "PatientIdentifierType" does not exist'),
      );
      prisma.patientAddress.findMany.mockResolvedValue([] as never);
      prisma.patientPhone.findMany.mockResolvedValue([] as never);
      prisma.patientEmail.findMany.mockResolvedValue([] as never);
      prisma.patientEmergencyContact.findMany.mockResolvedValue([] as never);
      prisma.patientAllergy.findMany.mockResolvedValue([] as never);
      prisma.biologicalSex.findUnique.mockResolvedValue(null as never);
      prisma.gender.findUnique.mockResolvedValue(null as never);
      prisma.maritalStatus.findUnique.mockResolvedValue(null as never);

      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.get({ id: MOCK_USER_ADMIN.id });

      // No lanza — devuelve fallback [] para identifiers y el resto OK.
      expect(out.identifiers).toEqual([]);
      expect(out.firstName).toBe("Ana");
    });

    it("RLS — get corre dentro de $transaction + demote", async () => {
      setupTx();
      prisma.patient.findFirst.mockResolvedValue({ id: MOCK_USER_ADMIN.id } as never);
      const caller = patientRouter.createCaller(makeCtx({ prisma }));

      await caller.get({ id: MOCK_USER_ADMIN.id });

      expect(prisma.$transaction).toHaveBeenCalled();
      const calls = prisma.$executeRawUnsafe.mock.calls.map((c) => String(c[0]));
      expect(calls.some((s) => s.includes("SET LOCAL ROLE authenticated"))).toBe(true);
    });
  });

  describe("create", () => {
    it("inyecta organizationId y createdBy desde el contexto", async () => {
      prisma.patient.create.mockResolvedValue({ id: "new" } as never);
      const caller = patientRouter.createCaller(makeCtx({ prisma }));

      await caller.create({
        mrn: "MRN-X",
        firstName: "Juan",
        lastName: "Pérez",
        biologicalSexId: "00000000-0000-0000-0000-000000000099",
      } as never);

      const args = prisma.patient.create.mock.calls[0]![0];
      expect(args.data).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        createdBy: MOCK_USER_ADMIN.id,
      });
    });

    it("falla sin tenant (FORBIDDEN)", async () => {
      const caller = patientRouter.createCaller(makeCtx({ prisma, tenant: null }));
      await expect(
        caller.create({
          mrn: "MRN-X",
          firstName: "Juan",
          lastName: "Pérez",
          biologicalSexId: "00000000-0000-0000-0000-000000000099",
        } as never),
      ).rejects.toBeInstanceOf(TRPCError);
    });
  });

  describe("addIdentifier", () => {
    it("acepta DUI válido", async () => {
      prisma.patientIdentifier.create.mockResolvedValue({ id: "x" } as never);
      const caller = patientRouter.createCaller(makeCtx({ prisma }));

      await caller.addIdentifier({
        patientId: "00000000-0000-0000-0000-000000000010",
        data: {
          identifierTypeId: "00000000-0000-0000-0000-000000000020",
          kind: "DUI",
          value: VALID_DUIS[0]!,
          isPrimary: true,
        },
      });

      expect(prisma.patientIdentifier.create).toHaveBeenCalledOnce();
    });

    it("rechaza DUI inválido vía superRefine antes de llegar a Prisma", async () => {
      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.addIdentifier({
          patientId: "00000000-0000-0000-0000-000000000010",
          data: {
            identifierTypeId: "00000000-0000-0000-0000-000000000020",
            kind: "DUI",
            value: INVALID_DUIS.badCheck,
            isPrimary: true,
          },
        }),
      ).rejects.toThrow();
      expect(prisma.patientIdentifier.create).not.toHaveBeenCalled();
    });
  });

  describe("addAllergy", () => {
    it("registra createdBy del usuario actual", async () => {
      prisma.patientAllergy.create.mockResolvedValue({ id: "y" } as never);
      const caller = patientRouter.createCaller(makeCtx({ prisma }));

      await caller.addAllergy({
        patientId: "00000000-0000-0000-0000-000000000010",
        data: {
          substanceText: "Penicilina",
          severity: "severe",
          verified: true,
        },
      });

      const args = prisma.patientAllergy.create.mock.calls[0]![0];
      expect(args.data).toMatchObject({ createdBy: MOCK_USER_ADMIN.id });
    });
  });
});
