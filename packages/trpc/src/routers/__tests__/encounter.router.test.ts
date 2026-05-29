/**
 * Tests del encounter router — admit, transfer, discharge.
 * Incluye verificación del hook automático ECE (ece.episodio_atencion).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { encounterRouter } from "../encounter.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_TENANT_NO_ESTABLISHMENT } from "@his/test-utils";

describe("encounterRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("admit", () => {
    /**
     * Helper: configura los mocks que usa la nueva pipeline de admit
     *  - paciente activo
     *  - sin encuentro abierto previo
     *  - $transaction ejecuta el callback con el mismo prisma mock
     */
    function setupAdmitHappyPath() {
      prisma.patient.findFirst.mockResolvedValue({
        id: "p1",
        active: true,
      } as never);
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      prisma.organization.findUnique.mockResolvedValue({
        functionalCurrency: "00000000-0000-0000-0000-000000000020",
      } as never);
      // $transaction(callback) corre el callback con el propio mock.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
        .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
          fn(prisma),
        );
    }

    it("genera encounterNumber con formato ENC-YYYY-NNNNNN", async () => {
      setupAdmitHappyPath();
      prisma.encounter.count.mockResolvedValue(41);
      prisma.encounter.create.mockImplementation(((args: { data: { encounterNumber: string } }) => {
        return Promise.resolve({ id: "e1", ...args.data }) as never;
      }) as never);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.admit({
        patientId: "00000000-0000-0000-0000-000000000010",
        admissionType: "EMERGENCY",
        currencyId: "00000000-0000-0000-0000-000000000020",
      } as never);

      const year = new Date().getFullYear();
      expect((out as { encounterNumber: string }).encounterNumber).toBe(
        `ENC-${year}-000042`,
      );
    });

    it("falla si el tenant no tiene establecimiento (FORBIDDEN)", async () => {
      const caller = encounterRouter.createCaller(
        makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
      );
      await expect(
        caller.admit({
          patientId: "00000000-0000-0000-0000-000000000010",
          admissionType: "EMERGENCY",
          currencyId: "00000000-0000-0000-0000-000000000020",
        } as never),
      ).rejects.toBeInstanceOf(TRPCError);
    });

    it("usa admittedAt del input si se provee", async () => {
      setupAdmitHappyPath();
      // SCHEDULED requiere bedId — mockeamos cama libre.
      prisma.bed.findFirst.mockResolvedValue({
        id: "b1",
        code: "C-01",
        status: "FREE",
      } as never);
      prisma.encounter.count.mockResolvedValue(0);
      prisma.encounter.create.mockResolvedValue({ id: "e2" } as never);
      const at = new Date("2026-01-15T08:00:00Z");

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await caller.admit({
        patientId: "00000000-0000-0000-0000-000000000010",
        admissionType: "SCHEDULED",
        currencyId: "00000000-0000-0000-0000-000000000020",
        bedId: "00000000-0000-0000-0000-000000000099",
        admittedAt: at,
      } as never);

      const args = prisma.encounter.create.mock.calls[0]![0];
      expect(args.data.admittedAt).toEqual(at);
    });

    it("retorna el encuentro abierto existente (idempotencia)", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: "p1", active: true } as never);
      const existing = {
        id: "e-existing",
        encounterNumber: "ENC-2026-000001",
        dischargedAt: null,
      };
      prisma.encounter.findFirst.mockResolvedValue(existing as never);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.admit({
        patientId: "00000000-0000-0000-0000-000000000010",
        admissionType: "EMERGENCY",
        currencyId: "00000000-0000-0000-0000-000000000020",
      } as never);

      expect((out as { id: string }).id).toBe("e-existing");
      expect(prisma.encounter.create).not.toHaveBeenCalled();
    });

    it("BIRTH/NEWBORN devuelven NOT_IMPLEMENTED en MVP", async () => {
      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admit({
          patientId: "00000000-0000-0000-0000-000000000010",
          admissionType: "BIRTH",
          currencyId: "00000000-0000-0000-0000-000000000020",
        } as never),
      ).rejects.toBeInstanceOf(TRPCError);
    });

    it("SCHEDULED sin bedId rechaza con BAD_REQUEST", async () => {
      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admit({
          patientId: "00000000-0000-0000-0000-000000000010",
          admissionType: "SCHEDULED",
          currencyId: "00000000-0000-0000-0000-000000000020",
        } as never),
      ).rejects.toBeInstanceOf(TRPCError);
    });
  });

  describe("transfer", () => {
    it("crea EncounterTransfer con razón y bedIds", async () => {
      prisma.encounterTransfer.create.mockResolvedValue({ id: "t1" } as never);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await caller.transfer({
        encounterId: "00000000-0000-0000-0000-000000000030",
        toServiceId: "00000000-0000-0000-0000-000000000031",
        fromBedId: "00000000-0000-0000-0000-000000000040",
        toBedId: "00000000-0000-0000-0000-000000000041",
        reason: "Cambio a UCI",
      });

      const args = prisma.encounterTransfer.create.mock.calls[0]![0];
      expect(args.data).toMatchObject({
        toBedId: "00000000-0000-0000-0000-000000000041",
        reason: "Cambio a UCI",
      });
    });
  });

  describe("discharge", () => {
    it("cierra encounter con dischargedAt y dischargeType", async () => {
      prisma.encounter.update.mockResolvedValue({ id: "e3" } as never);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await caller.discharge({
        encounterId: "00000000-0000-0000-0000-000000000050",
        dischargeType: "MEDICAL",
      });

      const args = prisma.encounter.update.mock.calls[0]![0];
      expect(args.data.dischargeType).toBe("MEDICAL");
      expect(args.data.dischargedAt).toBeInstanceOf(Date);
    });
  });

  describe("admit — hook ECE automático", () => {
    /**
     * Verifica que al admitir un encuentro no-BIRTH/NEWBORN, el hook ECE
     * ejecuta queries en ece.* a través de $queryRaw.
     *
     * Los hooks (resolveEceEstablecimientoId, hookEceEpisodioAfterAdmit) son
     * named imports — vi.spyOn no puede interceptarlos post-import en ESM.
     * En su lugar verificamos el comportamiento observable: las llamadas a
     * $queryRaw que el hook ejecuta internamente.
     */
    it("ejecuta queries ECE en $queryRaw tras admit exitoso", async () => {
      let qrawCallCount = 0;
      // $queryRaw respuestas en orden:
      //  0: resolveEceEstablecimientoId → ece.establecimiento encontrado
      //  1: hookEceEpisodioAfterAdmit: SELECT episodio existente → no existe
      //  2: hookEceEpisodioAfterAdmit: SELECT paciente ECE → existe
      //  3: hookEceEpisodioAfterAdmit: INSERT episodio → ok
      //  4+: GSRN tx (patient.findFirst, org, etc — no $queryRaw)
      prisma.$queryRaw.mockImplementation(() => {
        const responses = [
          [{ id: "ece-estab-uuid" }],  // resolveEceEstablecimientoId
          [],                           // SELECT episodio → no existe
          [{ id: "ece-pac-uuid" }],    // SELECT paciente ECE → existe
          [{ id: "episodio-new" }],    // INSERT episodio RETURNING
        ];
        return Promise.resolve(responses[qrawCallCount++] ?? []) as never;
      });

      prisma.patient.findFirst
        .mockResolvedValueOnce({ id: "p1", active: true } as never) // admit: verificar paciente
        .mockResolvedValueOnce({ id: "p1", mrn: "MRN-001" } as never) // hook ECE: cargar mrn
        .mockResolvedValueOnce(null as never); // GSRN: ya sin gsrn
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      prisma.organization.findUnique
        .mockResolvedValueOnce({ functionalCurrency: "curr-uuid" } as never)
        .mockResolvedValueOnce({ gs1CompanyPrefix: null } as never);
      prisma.encounter.count.mockResolvedValue(0);
      prisma.encounter.create.mockResolvedValue({
        id: "enc-uuid",
        admittedAt: new Date("2026-05-29"),
        admissionType: "EMERGENCY",
      } as never);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
        .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.admit({
        patientId: "00000000-0000-0000-0000-000000000010",
        admissionType: "EMERGENCY",
        currencyId: "00000000-0000-0000-0000-000000000020",
      } as never);

      // El admit retorna el encounter correctamente.
      expect((out as { id: string }).id).toBe("enc-uuid");
      // El hook ECE ejecutó al menos la query de resolveEceEstablecimientoId.
      expect(prisma.$queryRaw).toHaveBeenCalled();
      // Se ejecutaron las 4 queries ECE esperadas.
      expect(qrawCallCount).toBeGreaterThanOrEqual(4);
    });

    it("admit no falla si ece.establecimiento no está inicializado (hook non-fatal)", async () => {
      // $queryRaw retorna vacío → resolveEceEstablecimientoId = null → warn + return
      prisma.$queryRaw.mockResolvedValue([] as never);

      prisma.patient.findFirst
        .mockResolvedValueOnce({ id: "p1", active: true } as never)
        .mockResolvedValueOnce({ id: "p1", mrn: "MRN-001" } as never)
        .mockResolvedValueOnce(null as never);
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      prisma.organization.findUnique
        .mockResolvedValueOnce({ functionalCurrency: "curr-uuid" } as never)
        .mockResolvedValueOnce({ gs1CompanyPrefix: null } as never);
      prisma.encounter.count.mockResolvedValue(0);
      prisma.encounter.create.mockResolvedValue({
        id: "enc-uuid-2",
        admittedAt: new Date(),
        admissionType: "EMERGENCY",
      } as never);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
        .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      // Debe resolver aunque ECE no esté inicializado (warn en stderr)
      const out = await caller.admit({
        patientId: "00000000-0000-0000-0000-000000000010",
        admissionType: "EMERGENCY",
        currencyId: "00000000-0000-0000-0000-000000000020",
      } as never);

      expect((out as { id: string }).id).toBe("enc-uuid-2");
    });

    it("admit BIRTH no ejecuta queries ECE (flujo exclusivo atencion-rn)", async () => {
      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.admit({
          patientId: "00000000-0000-0000-0000-000000000010",
          admissionType: "BIRTH",
          currencyId: "00000000-0000-0000-0000-000000000020",
        } as never),
      ).rejects.toBeInstanceOf(TRPCError);

      // BIRTH lanza NOT_IMPLEMENTED — nunca llega al hook ECE.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("filtra por status=OPEN aplica dischargedAt:null", async () => {
      prisma.encounter.findMany.mockResolvedValue([] as never);
      prisma.encounter.count.mockResolvedValue(0);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ status: "OPEN", page: 1, pageSize: 20 });

      const args = prisma.encounter.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        dischargedAt: null,
      });
    });

    it("filtra por status=CLOSED aplica dischargedAt:{not:null}", async () => {
      prisma.encounter.findMany.mockResolvedValue([] as never);
      prisma.encounter.count.mockResolvedValue(0);

      const caller = encounterRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ status: "CLOSED", page: 1, pageSize: 20 });

      const args = prisma.encounter.findMany.mock.calls[0]![0];
      expect(args.where.dischargedAt).toEqual({ not: null });
    });
  });
});
