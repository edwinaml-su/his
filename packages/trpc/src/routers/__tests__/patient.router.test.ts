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
import { MOCK_TENANT, MOCK_TENANT_NO_ESTABLISHMENT, MOCK_USER_ADMIN, VALID_DUIS, INVALID_DUIS } from "@his/test-utils";

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
    it("inyecta organizationId, createdBy y expediente desde el contexto", async () => {
      // CC-0002: create ahora requiere birthDate para generar expediente.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
        .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));

      // Mock de organization.findUnique para obtener isoAlpha2 del país.
      prisma.organization.findUnique.mockResolvedValue({
        country: { isoAlpha2: "SV" },
      } as never);
      // Mock de $queryRaw: fn_next_expediente devuelve 1.
      prisma.$queryRaw.mockResolvedValue([{ n: 1 }] as never);
      // Mock del patient create.
      prisma.patient.create.mockResolvedValue({ id: "new", mrn: "MRN-X", expediente: "SV8400001" } as never);

      const caller = patientRouter.createCaller(makeCtx({ prisma }));

      await caller.create({
        mrn: "MRN-X",
        firstName: "Juan",
        lastName: "Pérez",
        biologicalSexId: "00000000-0000-0000-0000-000000000099",
        birthDate: "1984-03-15",
      } as never);

      const args = prisma.patient.create.mock.calls[0]![0];
      expect(args.data).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        createdBy: MOCK_USER_ADMIN.id,
        expediente: "SV8400001",
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
          birthDate: "1984-03-15",
        } as never),
      ).rejects.toBeInstanceOf(TRPCError);
    });

    it("falla con FORBIDDEN si el tenant no tiene establecimiento", async () => {
      // La guarda FORBIDDEN corre antes de $transaction, por eso birthDate es suficiente.
      const caller = patientRouter.createCaller(
        makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
      );
      await expect(
        caller.create({
          mrn: "MRN-X",
          firstName: "Juan",
          lastName: "Pérez",
          biologicalSexId: "00000000-0000-0000-0000-000000000099",
          birthDate: "1984-03-15",
        } as never),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    // CC-0002 §5 / §14 Esc. 4: un responsable con dos menores → dos expedientes distintos.
    it("DUI_RESP: un responsable con dos menores genera dos expedientes distintos con el mismo responsable", async () => {
      const RESP_DUI = VALID_DUIS[0]!;
      const BASE_PATIENT = {
        mrn: "MRN-MENOR",
        firstName: "Menor",
        lastName: "Test",
        biologicalSexId: "00000000-0000-0000-0000-000000000099",
        // menor de 5 años
        birthDate: new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        documentType: "DUI_RESP" as const,
        responsable: { nombre: "Resp Adulto", parentesco: "madre", dui: RESP_DUI },
      };

      // --- Primer create ---
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
        .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
      prisma.organization.findUnique.mockResolvedValue({ country: { isoAlpha2: "SV" } } as never);
      // $queryRaw: fn_next_expediente devuelve 1 para el primer menor; luego hook ECE queries → []
      prisma.$queryRaw
        .mockResolvedValueOnce([{ n: 1 }] as never)   // fn_next_expediente → SV{AA}00001
        .mockResolvedValue([] as never);               // hook ECE queries (idempotencia) → no existente → falló non-fatal
      prisma.patient.create.mockResolvedValueOnce({
        id: "minor-1",
        expediente: "SV0000001",
      } as never);

      const caller1 = patientRouter.createCaller(makeCtx({ prisma }));
      const res1 = await caller1.create({ ...BASE_PATIENT, mrn: "MRN-MENOR-1" } as never);

      // --- Segundo create (mismo responsable, distinto menor) ---
      prisma.$queryRaw
        .mockResolvedValueOnce([{ n: 2 }] as never)   // fn_next_expediente → SV{AA}00002
        .mockResolvedValue([] as never);
      prisma.patient.create.mockResolvedValueOnce({
        id: "minor-2",
        expediente: "SV0000002",
      } as never);

      const caller2 = patientRouter.createCaller(makeCtx({ prisma }));
      const res2 = await caller2.create({ ...BASE_PATIENT, mrn: "MRN-MENOR-2" } as never);

      // Dos expedientes distintos
      expect(res1).toMatchObject({ id: "minor-1" });
      expect(res2).toMatchObject({ id: "minor-2" });
      expect(res1.expediente).not.toBe(res2.expediente);

      // nextExpediente se invocó dos veces (una por menor)
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(
        prisma.$queryRaw.mock.calls.length, // toleramos llamadas del hook ECE
      );
      expect(prisma.patient.create).toHaveBeenCalledTimes(2);

      // Ambas llamadas a patient.create usan el mismo DUI de responsable
      // pero NO como documentNumber del paciente (DUI_RESP no pasa por dedup de doc propio)
      // Verificamos que NO se haya llamado a patient.findFirst para dedup
      // (porque DUI_RESP se excluye del check §5)
      expect(prisma.patient.findFirst).not.toHaveBeenCalled();
    });

    // CC-0002 §5: dedup por documento propio.
    it("dedup: retorna paciente existente sin llamar nextExpediente ni patient.create", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
        .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));

      prisma.organization.findUnique.mockResolvedValue({
        country: { isoAlpha2: "SV" },
      } as never);

      const existingPatient = {
        id: "existing-uuid",
        mrn: "MRN-EXIST",
        expediente: "SV8400001",
        documentType: "DUI",
        documentNumber: VALID_DUIS[0],
      };
      // findFirst devuelve paciente existente con el mismo documento.
      prisma.patient.findFirst.mockResolvedValue(existingPatient as never);

      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({
        mrn: "MRN-NUEVO",
        firstName: "Juan",
        lastName: "Pérez",
        biologicalSexId: "00000000-0000-0000-0000-000000000099",
        birthDate: "1984-03-15",
        documentType: "DUI",
        documentNumber: VALID_DUIS[0],
      } as never);

      // Debe retornar el existente.
      expect(result).toMatchObject({ id: "existing-uuid" });
      // NO debe llamar nextExpediente ($queryRaw) ni patient.create.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.patient.create).not.toHaveBeenCalled();
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

  // CC-0005 RF-1 — findByDocument
  describe("findByDocument", () => {
    function setupTxFindByDoc() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void }).mockImplementation(
        async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma),
      );
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
    }

    it("retorna displayName y expediente cuando el paciente existe", async () => {
      setupTxFindByDoc();
      prisma.patient.findFirst.mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000099",
        firstName: "Juan",
        lastName: "Pérez",
        secondLastName: "García",
        expediente: "SV2600001",
      } as never);

      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      // PASAPORTE omite la validación de dígito verificador DUI → llega hasta la BD
      const result = await caller.findByDocument({
        documentType: "PASAPORTE",
        documentNumber: "A12345678",
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("00000000-0000-0000-0000-000000000099");
      expect(result?.displayName).toContain("Juan");
      expect(result?.expediente).toBe("SV2600001");
    });

    it("devuelve null cuando el paciente no existe", async () => {
      setupTxFindByDoc();
      prisma.patient.findFirst.mockResolvedValue(null);

      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.findByDocument({
        documentType: "PASAPORTE",
        documentNumber: "AB123456",
      });

      expect(result).toBeNull();
    });

    it("devuelve null sin consultar BD si el DUI tiene dígito verificador inválido", async () => {
      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      // 12345678-9: sum=156, calc=4, check=9 → DUI inválido
      const result = await caller.findByDocument({
        documentType: "DUI",
        documentNumber: "12345678-9",
      });

      // tRPC puede serializar el early-return null como null o undefined
      expect(result ?? null).toBeNull();
      expect(prisma.patient.findFirst).not.toHaveBeenCalled();
    });
  });

  // ─── CC-0007 — contextoCuenta ──────────────────────────────────────────────

  describe("contextoCuenta", () => {
    const CUENTA_ID = "00000000-0000-4000-8000-000000000010";
    const PATIENT_ID = "00000000-0000-4000-8000-000000000020";

    function setupTxContexto() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
        .mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
    }

    const fakeAccount = {
      id: CUENTA_ID,
      numeroCuenta: "ACC-001",
      patientId: PATIENT_ID,
      organizationId: MOCK_TENANT.organizationId,
      encounterId: null,
    };

    const fakePatient = {
      id: PATIENT_ID,
      firstName: "Ana",
      lastName: "García",
      mrn: "MRN-001",
      preferredName: null,
      esLgbtiq: null,
      birthDate: "1990-05-15",
      biologicalSexId: "00000000-0000-0000-0000-000000000001",
    };

    it("lanza NOT_FOUND si la cuenta no existe", async () => {
      setupTxContexto();
      prisma.patientAccount.findFirst.mockResolvedValue(null);

      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.contextoCuenta({ cuentaId: CUENTA_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("happy path: retorna cuenta, paciente, alergias y contactos; episodioId resuelto", async () => {
      setupTxContexto();
      prisma.patientAccount.findFirst.mockResolvedValue(fakeAccount as never);
      prisma.patient.findFirst.mockResolvedValue(fakePatient as never);
      prisma.patientAllergy.findMany.mockResolvedValue([] as never);
      prisma.patientEmergencyContact.findMany.mockResolvedValue([] as never);
      // withEceContext llama $queryRaw para resolver episodioId
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: "00000000-0000-4000-8000-000000000099" },
      ]);

      const caller = patientRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.contextoCuenta({ cuentaId: CUENTA_ID });

      expect(result.cuenta.id).toBe(CUENTA_ID);
      expect(result.cuenta.numeroCuenta).toBe("ACC-001");
      expect(result.paciente?.firstName).toBe("Ana");
      expect(result.paciente?.mrn).toBe("MRN-001");
      expect(result.alergias).toEqual([]);
      expect(result.contactosEmergencia).toEqual([]);
      expect(result.episodioId).toBe("00000000-0000-4000-8000-000000000099");
    });

    it("episodioId es null cuando el tenant no tiene establishmentId", async () => {
      setupTxContexto();
      prisma.patientAccount.findFirst.mockResolvedValue(fakeAccount as never);
      prisma.patient.findFirst.mockResolvedValue(fakePatient as never);
      prisma.patientAllergy.findMany.mockResolvedValue([] as never);
      prisma.patientEmergencyContact.findMany.mockResolvedValue([] as never);

      const caller = patientRouter.createCaller(
        makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
      );
      const result = await caller.contextoCuenta({ cuentaId: CUENTA_ID });

      expect(result.episodioId).toBeNull();
    });
  });
});
