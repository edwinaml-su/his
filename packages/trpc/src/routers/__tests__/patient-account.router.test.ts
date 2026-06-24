/**
 * CC-0002 §7 — Tests del patientAccountRouter.
 * Mock: PrismaClient (vitest-mock-extended) + patrón setupTx (mismo que
 * patient.router.test) para que withTenantContext ejecute el callback
 * con el prisma mock, exponiendo los métodos delegados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { patientAccountRouter } from "../patient-account.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN } from "@his/test-utils";

const PATIENT_ID = "00000000-0000-0000-0000-000000000001";
const ACCOUNT_ID = "00000000-0000-0000-0000-000000000002";
const ENCOUNTER_ID = "00000000-0000-0000-0000-000000000003";

describe("patientAccountRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  /**
   * withTenantContext llama prisma.$transaction(callback).
   * Mockeamos $transaction para que ejecute el callback con el propio prisma
   * como tx, igual que en patient.router.test.
   * También mockeamos $executeRawUnsafe (llamado por applyTenantContext).
   */
  function setupTx() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void }).mockImplementation(
      async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma),
    );
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
    // fn_next_cuenta se llama con $queryRaw tagged template
    prisma.$queryRaw.mockResolvedValue([{ n: 1 }] as never);
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("crear", () => {
    it("genera numeroCuenta CTA00001 y persiste con organizationId del tenant", async () => {
      setupTx();
      const fakeAccount = {
        id: ACCOUNT_ID,
        organizationId: MOCK_TENANT.organizationId,
        patientId: PATIENT_ID,
        numeroCuenta: "CTA00001",
        encounterId: null,
        createdAt: new Date(),
        createdBy: MOCK_USER_ADMIN.id,
      };
      prisma.patientAccount.create.mockResolvedValue(fakeAccount as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.crear({ patientId: PATIENT_ID });

      expect(result).toMatchObject({ numeroCuenta: "CTA00001" });
      const createArgs = prisma.patientAccount.create.mock.calls[0]![0];
      expect(createArgs.data).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        patientId: PATIENT_ID,
        numeroCuenta: "CTA00001",
      });
    });

    it("acepta cuenta sin encounterId (paciente ambulatorio)", async () => {
      setupTx();
      prisma.patientAccount.create.mockResolvedValue({
        id: ACCOUNT_ID,
        numeroCuenta: "CTA00001",
        encounterId: null,
      } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      // NO pasa encounterId → debe crear igualmente
      await expect(caller.crear({ patientId: PATIENT_ID })).resolves.toBeDefined();

      const createArgs = prisma.patientAccount.create.mock.calls[0]![0];
      expect(createArgs.data.encounterId).toBeNull();
    });

    it("pasa encounterId cuando se proporciona", async () => {
      setupTx();
      prisma.patientAccount.create.mockResolvedValue({
        id: ACCOUNT_ID,
        numeroCuenta: "CTA00001",
        encounterId: ENCOUNTER_ID,
      } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await caller.crear({ patientId: PATIENT_ID, encounterId: ENCOUNTER_ID });

      const createArgs = prisma.patientAccount.create.mock.calls[0]![0];
      expect(createArgs.data.encounterId).toBe(ENCOUNTER_ID);
    });

    it("corre dentro de $transaction (RLS aplicado)", async () => {
      setupTx();
      prisma.patientAccount.create.mockResolvedValue({ id: ACCOUNT_ID } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await caller.crear({ patientId: PATIENT_ID });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const rawCalls = prisma.$executeRawUnsafe.mock.calls.map((c) => String(c[0]));
      expect(rawCalls.some((s) => s.includes("set_tenant_context"))).toBe(true);
    });
  });

  describe("agregarServicio", () => {
    it("crea servicio NO_HOSPITALARIO en la cuenta indicada", async () => {
      setupTx();
      const fakeService = {
        id: "00000000-0000-0000-0000-000000000004",
        accountId: ACCOUNT_ID,
        tipo: "NO_HOSPITALARIO",
        descripcion: null,
        encounterId: null,
        createdAt: new Date(),
        createdBy: MOCK_USER_ADMIN.id,
      };
      prisma.patientAccountService.create.mockResolvedValue(fakeService as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.agregarServicio({
        accountId: ACCOUNT_ID,
        tipo: "NO_HOSPITALARIO",
      });

      expect(result.tipo).toBe("NO_HOSPITALARIO");
      const args = prisma.patientAccountService.create.mock.calls[0]![0];
      expect(args.data).toMatchObject({
        accountId: ACCOUNT_ID,
        tipo: "NO_HOSPITALARIO",
      });
    });

    it("crea servicio HOSPITALARIO con descripcion y encounterId", async () => {
      setupTx();
      prisma.patientAccountService.create.mockResolvedValue({
        tipo: "HOSPITALARIO",
        encounterId: ENCOUNTER_ID,
      } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await caller.agregarServicio({
        accountId: ACCOUNT_ID,
        tipo: "HOSPITALARIO",
        descripcion: "Hospitalización general",
        encounterId: ENCOUNTER_ID,
      });

      const args = prisma.patientAccountService.create.mock.calls[0]![0];
      expect(args.data).toMatchObject({
        tipo: "HOSPITALARIO",
        descripcion: "Hospitalización general",
        encounterId: ENCOUNTER_ID,
      });
    });

    it("rechaza tipo inválido (Zod)", async () => {
      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        caller.agregarServicio({ accountId: ACCOUNT_ID, tipo: "INVALIDO" as any }),
      ).rejects.toThrow();
    });
  });

  describe("listarPorPaciente", () => {
    it("devuelve cuentas del paciente con servicios incluidos, ordenadas por numeroCuenta", async () => {
      setupTx();
      const fakeCuentas = [
        { id: ACCOUNT_ID, numeroCuenta: "CTA00001", servicios: [] },
        { id: "00000000-0000-0000-0000-000000000005", numeroCuenta: "CTA00002", servicios: [] },
      ];
      prisma.patientAccount.findMany.mockResolvedValue(fakeCuentas as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listarPorPaciente({ patientId: PATIENT_ID });

      expect(result).toHaveLength(2);
      const args = prisma.patientAccount.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        patientId: PATIENT_ID,
        organizationId: MOCK_TENANT.organizationId,
      });
      expect(args.include).toMatchObject({ servicios: true });
      expect(args.orderBy).toMatchObject({ numeroCuenta: "asc" });
    });
  });
});
