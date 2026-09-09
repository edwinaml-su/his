/**
 * CC-0002 §7 — Tests del patientAccountRouter.
 * Mock: PrismaClient (vitest-mock-extended) + patrón setupTx (mismo que
 * patient.router.test) para que withTenantContext ejecute el callback
 * con el prisma mock, exponiendo los métodos delegados.
 *
 * CC-0015: `crear` ahora requiere `tipoCuentaId` (valida que exista, esté
 * activo y pertenezca al tenant) y acepta `servicio` opcional.
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
const TIPO_CUENTA_ID = "00000000-0000-0000-0000-000000000006";

const FAKE_TIPO_CUENTA = {
  id: TIPO_CUENTA_ID,
  organizationId: MOCK_TENANT.organizationId,
  code: "PARTICULAR",
  nombre: "Particular",
  priceListId: null,
  insurerId: null,
  esParticular: true,
  active: true,
};

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
    // CC-0015 — crear valida el tipoCuenta antes de generar el correlativo.
    prisma.tipoCuenta.findFirst.mockResolvedValue(FAKE_TIPO_CUENTA as never);
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("crear", () => {
    it("genera numeroCuenta CTA00001 y persiste con organizationId + tipoCuentaId del tenant", async () => {
      setupTx();
      const fakeAccount = {
        id: ACCOUNT_ID,
        organizationId: MOCK_TENANT.organizationId,
        patientId: PATIENT_ID,
        numeroCuenta: "CTA00001",
        encounterId: null,
        tipoCuentaId: TIPO_CUENTA_ID,
        createdAt: new Date(),
        createdBy: MOCK_USER_ADMIN.id,
      };
      prisma.patientAccount.create.mockResolvedValue(fakeAccount as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.crear({ patientId: PATIENT_ID, tipoCuentaId: TIPO_CUENTA_ID });

      expect(result).toMatchObject({ numeroCuenta: "CTA00001" });
      const createArgs = prisma.patientAccount.create.mock.calls[0]![0];
      expect(createArgs.data).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        patientId: PATIENT_ID,
        numeroCuenta: "CTA00001",
        tipoCuentaId: TIPO_CUENTA_ID,
        status: "ABIERTA",
      });
    });

    // docs/48 Ola 1 (C1-5) — RN-HIS-BOT-001 R1: emergencia sin pagador definido.
    it("abre PENDIENTE_REGULARIZAR cuando emergenciaSinPagador es true", async () => {
      setupTx();
      prisma.patientAccount.create.mockResolvedValue({ id: ACCOUNT_ID, numeroCuenta: "CTA00001" } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await caller.crear({ patientId: PATIENT_ID, tipoCuentaId: TIPO_CUENTA_ID, emergenciaSinPagador: true });

      const createArgs = prisma.patientAccount.create.mock.calls[0]![0];
      expect(createArgs.data.status).toBe("PENDIENTE_REGULARIZAR");
    });

    it("rechaza si tipoCuentaId no existe o está inactivo en el tenant", async () => {
      setupTx();
      prisma.tipoCuenta.findFirst.mockResolvedValue(null as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.crear({ patientId: PATIENT_ID, tipoCuentaId: TIPO_CUENTA_ID }),
      ).rejects.toThrow(/Tipo de cuenta no encontrado o inactivo/);
      expect(prisma.patientAccount.create).not.toHaveBeenCalled();
    });

    it("rechaza tipoCuentaId ausente (Zod)", async () => {
      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        caller.crear({ patientId: PATIENT_ID } as any),
      ).rejects.toThrow();
    });

    it("acepta cuenta sin encounterId (paciente ambulatorio)", async () => {
      setupTx();
      prisma.patientAccount.create.mockResolvedValue({
        id: ACCOUNT_ID,
        numeroCuenta: "CTA00001",
        encounterId: null,
        tipoCuentaId: TIPO_CUENTA_ID,
      } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      // NO pasa encounterId → debe crear igualmente
      await expect(
        caller.crear({ patientId: PATIENT_ID, tipoCuentaId: TIPO_CUENTA_ID }),
      ).resolves.toBeDefined();

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
      await caller.crear({ patientId: PATIENT_ID, tipoCuentaId: TIPO_CUENTA_ID, encounterId: ENCOUNTER_ID });

      const createArgs = prisma.patientAccount.create.mock.calls[0]![0];
      expect(createArgs.data.encounterId).toBe(ENCOUNTER_ID);
    });

    it("crea el servicio inline cuando se proporciona `servicio`", async () => {
      setupTx();
      prisma.patientAccount.create.mockResolvedValue({
        id: ACCOUNT_ID,
        numeroCuenta: "CTA00001",
      } as never);
      prisma.patientAccountService.create.mockResolvedValue({ id: "svc-1" } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await caller.crear({
        patientId: PATIENT_ID,
        tipoCuentaId: TIPO_CUENTA_ID,
        servicio: { tipo: "NO_HOSPITALARIO" },
      });

      expect(prisma.patientAccountService.create).toHaveBeenCalledTimes(1);
      const svcArgs = prisma.patientAccountService.create.mock.calls[0]![0];
      expect(svcArgs.data).toMatchObject({ accountId: ACCOUNT_ID, tipo: "NO_HOSPITALARIO" });
    });

    it("no crea servicio cuando `servicio` no se proporciona", async () => {
      setupTx();
      prisma.patientAccount.create.mockResolvedValue({ id: ACCOUNT_ID, numeroCuenta: "CTA00001" } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await caller.crear({ patientId: PATIENT_ID, tipoCuentaId: TIPO_CUENTA_ID });

      expect(prisma.patientAccountService.create).not.toHaveBeenCalled();
    });

    it("corre dentro de $transaction (RLS aplicado)", async () => {
      setupTx();
      prisma.patientAccount.create.mockResolvedValue({ id: ACCOUNT_ID } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await caller.crear({ patientId: PATIENT_ID, tipoCuentaId: TIPO_CUENTA_ID });

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
    it("devuelve cuentas del paciente con servicios y tipoCuenta incluidos, ordenadas por numeroCuenta", async () => {
      setupTx();
      const fakeCuentas = [
        { id: ACCOUNT_ID, numeroCuenta: "CTA00001", servicios: [], tipoCuenta: FAKE_TIPO_CUENTA },
        { id: "00000000-0000-0000-0000-000000000005", numeroCuenta: "CTA00002", servicios: [], tipoCuenta: null },
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
      expect(args.include).toMatchObject({
        servicios: true,
        tipoCuenta: { select: { id: true, code: true, nombre: true } },
      });
      expect(args.orderBy).toMatchObject({ numeroCuenta: "asc" });
    });
  });

  // docs/48 Ola 4 (C4-1) — cierre bloqueante.
  describe("cerrar", () => {
    function mockAccount(overrides: Partial<{ status: string }> = {}) {
      return {
        id: ACCOUNT_ID,
        organizationId: MOCK_TENANT.organizationId,
        status: overrides.status ?? "ABIERTA",
      };
    }

    it("NOT_FOUND si la cuenta no existe en el tenant", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue(null as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.cerrar({ accountId: ACCOUNT_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("PRECONDITION_FAILED si la cuenta ya está CERRADA", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue(mockAccount({ status: "CERRADA" }) as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.cerrar({ accountId: ACCOUNT_ID })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(prisma.patientAccount.update).not.toHaveBeenCalled();
    });

    it("cierra la cuenta cuando no hay causas de bloqueo", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue(mockAccount() as never);
      prisma.patientAccountService.findMany
        .mockResolvedValueOnce([] as never) // pendientesTarifa
        .mockResolvedValueOnce([] as never); // cargosDispensacionVigentes
      prisma.patientAccount.update.mockResolvedValue({
        ...mockAccount(),
        status: "CERRADA",
      } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.cerrar({ accountId: ACCOUNT_ID });

      expect(result.status).toBe("CERRADA");
      const updateArgs = prisma.patientAccount.update.mock.calls[0]![0];
      expect(updateArgs.where).toEqual({ id: ACCOUNT_ID });
      expect(updateArgs.data).toMatchObject({
        status: "CERRADA",
        closedBy: MOCK_USER_ADMIN.id,
      });
      expect(updateArgs.data.closedAt).toBeInstanceOf(Date);
      expect(prisma.pharmacyReservation.findMany).not.toHaveBeenCalled();
    });

    it("bloquea listando cargos PENDIENTE_TARIFA (conteo + primeros codes)", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue(mockAccount() as never);
      prisma.patientAccountService.findMany
        .mockResolvedValueOnce([{ code: "MED-001" }, { code: "MED-002" }] as never)
        .mockResolvedValueOnce([] as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      const err = await caller.cerrar({ accountId: ACCOUNT_ID }).catch((e) => e);

      expect(err).toMatchObject({ code: "PRECONDITION_FAILED" });
      const causas = (err.cause as { causas: Array<Record<string, unknown>> }).causas;
      expect(causas).toContainEqual(
        expect.objectContaining({
          tipo: "CARGOS_PENDIENTE_TARIFA",
          count: 2,
          codes: ["MED-001", "MED-002"],
        }),
      );
      expect(prisma.patientAccount.update).not.toHaveBeenCalled();
    });

    it("bloquea por cuenta PENDIENTE_REGULARIZAR (pagador sin definir — R1)", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue(
        mockAccount({ status: "PENDIENTE_REGULARIZAR" }) as never,
      );
      prisma.patientAccountService.findMany
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      const err = await caller.cerrar({ accountId: ACCOUNT_ID }).catch((e) => e);

      expect(err).toMatchObject({ code: "PRECONDITION_FAILED" });
      const causas = (err.cause as { causas: Array<Record<string, unknown>> }).causas;
      expect(causas).toContainEqual(
        expect.objectContaining({ tipo: "CUENTA_PENDIENTE_REGULARIZAR" }),
      );
    });

    it("bloquea por devolución de farmacia sin reversión (reserva CANCELLED + cargo VIGENTE)", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue(mockAccount() as never);
      prisma.patientAccountService.findMany
        .mockResolvedValueOnce([] as never) // pendientesTarifa
        .mockResolvedValueOnce([{ id: "cargo-1", referenciaId: "res-1" }] as never); // dispensación vigente
      prisma.pharmacyReservation.findMany.mockResolvedValue([{ id: "res-1" }] as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      const err = await caller.cerrar({ accountId: ACCOUNT_ID }).catch((e) => e);

      expect(err).toMatchObject({ code: "PRECONDITION_FAILED" });
      const causas = (err.cause as { causas: Array<Record<string, unknown>> }).causas;
      expect(causas).toContainEqual(
        expect.objectContaining({ tipo: "DEVOLUCION_SIN_REVERSION", count: 1, cargoIds: ["cargo-1"] }),
      );
      expect(prisma.pharmacyReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { in: ["res-1"] }, status: "CANCELLED" }) }),
      );
    });

    it("no marca devolución sin reversión si la reserva referenciada no está CANCELLED", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue(mockAccount() as never);
      prisma.patientAccountService.findMany
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{ id: "cargo-1", referenciaId: "res-1" }] as never);
      // La query real filtra status='CANCELLED' — simulamos que no matcheó nada.
      prisma.pharmacyReservation.findMany.mockResolvedValue([] as never);
      prisma.patientAccount.update.mockResolvedValue(mockAccount({ status: "CERRADA" }) as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.cerrar({ accountId: ACCOUNT_ID })).resolves.toBeDefined();
    });

    it("lista TODAS las causas presentes simultáneamente (no solo la primera)", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue(
        mockAccount({ status: "PENDIENTE_REGULARIZAR" }) as never,
      );
      prisma.patientAccountService.findMany
        .mockResolvedValueOnce([{ code: "MED-001" }] as never)
        .mockResolvedValueOnce([{ id: "cargo-1", referenciaId: "res-1" }] as never);
      prisma.pharmacyReservation.findMany.mockResolvedValue([{ id: "res-1" }] as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      const err = await caller.cerrar({ accountId: ACCOUNT_ID }).catch((e) => e);

      const causas = (err.cause as { causas: Array<Record<string, unknown>> }).causas;
      expect(causas.map((c) => c.tipo)).toEqual(
        expect.arrayContaining([
          "CARGOS_PENDIENTE_TARIFA",
          "CUENTA_PENDIENTE_REGULARIZAR",
          "DEVOLUCION_SIN_REVERSION",
        ]),
      );
      expect(causas).toHaveLength(3);
    });
  });

  // docs/48 Ola 4 (C4-1) — regularización de cuenta PENDIENTE_REGULARIZAR.
  describe("regularizar", () => {
    it("asigna tipoCuentaId y pasa la cuenta a ABIERTA", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue({
        id: ACCOUNT_ID,
        organizationId: MOCK_TENANT.organizationId,
        status: "PENDIENTE_REGULARIZAR",
      } as never);
      prisma.tipoCuenta.findFirst.mockResolvedValue(FAKE_TIPO_CUENTA as never);
      prisma.patientAccount.update.mockResolvedValue({
        id: ACCOUNT_ID,
        status: "ABIERTA",
        tipoCuentaId: TIPO_CUENTA_ID,
      } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.regularizar({ accountId: ACCOUNT_ID, tipoCuentaId: TIPO_CUENTA_ID });

      expect(result.status).toBe("ABIERTA");
      expect(prisma.patientAccount.update).toHaveBeenCalledWith({
        where: { id: ACCOUNT_ID },
        data: { tipoCuentaId: TIPO_CUENTA_ID, status: "ABIERTA" },
      });
    });

    it("NOT_FOUND si la cuenta no existe en el tenant", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue(null as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.regularizar({ accountId: ACCOUNT_ID, tipoCuentaId: TIPO_CUENTA_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("PRECONDITION_FAILED si la cuenta no está PENDIENTE_REGULARIZAR", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue({
        id: ACCOUNT_ID,
        organizationId: MOCK_TENANT.organizationId,
        status: "ABIERTA",
      } as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.regularizar({ accountId: ACCOUNT_ID, tipoCuentaId: TIPO_CUENTA_ID }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(prisma.patientAccount.update).not.toHaveBeenCalled();
    });

    it("BAD_REQUEST si tipoCuentaId no existe o está inactivo", async () => {
      setupTx();
      prisma.patientAccount.findFirst.mockResolvedValue({
        id: ACCOUNT_ID,
        organizationId: MOCK_TENANT.organizationId,
        status: "PENDIENTE_REGULARIZAR",
      } as never);
      prisma.tipoCuenta.findFirst.mockResolvedValue(null as never);

      const caller = patientAccountRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.regularizar({ accountId: ACCOUNT_ID, tipoCuentaId: TIPO_CUENTA_ID }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(prisma.patientAccount.update).not.toHaveBeenCalled();
    });
  });
});
