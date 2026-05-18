/**
 * Tests del procedure `pharmacy.dispense.checkAllergies` — US.F2.6.10.
 *
 * Cubre:
 *   - Hard stop por principio activo (alergia PatientAllergy v1)
 *   - Warning por excipiente alergénico
 *   - Ok cuando no hay matches
 *   - Publicación de evento outbox `pharmacy.allergy-detected` en hard stop
 *   - Fármaco no encontrado → 404
 *
 * La lógica pura `evaluateAllergyCheck` se testa por separado en
 * packages/contracts/src/schemas/__tests__/allergy-check.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { pharmacyRouter } from "../pharmacy.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const uuid = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

function setupTx<P extends DeepMockProxy<PrismaClient>>(prisma: P) {
  (prisma.$transaction as unknown as { mockImplementation: (fn: unknown) => void })
    .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
}

/** Drug con principio activo Penicilina (allergyFamilies). */
const DRUG_AMOX = {
  id: uuid(10),
  name: "Amoxicilina 500 mg",
  allergyFamilies: ["penicilina", "betalactámicos"],
  allergyExcipients: [] as string[],
};

/** Drug con excipiente tartrazina. */
const DRUG_PARA = {
  id: uuid(11),
  name: "Paracetamol 500 mg naranja",
  allergyFamilies: ["paracetamol"],
  allergyExcipients: ["tartrazina"],
};

/** Drug sin alergénos. */
const DRUG_IBUP = {
  id: uuid(12),
  name: "Ibuprofeno 400 mg",
  allergyFamilies: ["aine"],
  allergyExcipients: [] as string[],
};

describe("pharmacy.dispense.checkAllergies · hard stop", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let caller: ReturnType<typeof pharmacyRouter.createCaller>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);

    // Mock withTenantContext — hace $transaction internamente; el mock ya lo cubre.
    vi.mock("../../rls-context", () => ({
      withTenantContext: async (
        _prisma: unknown,
        _tenant: unknown,
        fn: (tx: unknown) => Promise<unknown>,
      ) => fn(_prisma),
    }));

    caller = pharmacyRouter.createCaller(makeCtx({ prisma: prisma as unknown as PrismaClient }));
  });

  it("devuelve hardStop cuando el paciente tiene alergia a principio activo del drug", async () => {
    prisma.drug.findFirst.mockResolvedValue(DRUG_AMOX as never);
    prisma.patientAllergy.findMany.mockResolvedValue([
      {
        id: uuid(20),
        substanceText: "Penicilina",
        severity: "severe",
        active: true,
      },
    ] as never);
    prisma.allergyIntolerance.findMany.mockResolvedValue([] as never);

    const result = await caller.dispense.checkAllergies({
      patientId: uuid(1),
      drugId: DRUG_AMOX.id,
    });

    expect(result.status).toBe("hardStop");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.type).toBe("activeIngredient");
  });

  it("publica evento pharmacy.allergy-detected al outbox en hard stop", async () => {
    prisma.drug.findFirst.mockResolvedValue(DRUG_AMOX as never);
    prisma.patientAllergy.findMany.mockResolvedValue([
      { id: uuid(20), substanceText: "Penicilina", severity: "severe", active: true },
    ] as never);
    prisma.allergyIntolerance.findMany.mockResolvedValue([] as never);
    prisma.domainEvent.create.mockResolvedValue({ id: uuid(99) } as never);

    await caller.dispense.checkAllergies({
      patientId: uuid(1),
      drugId: DRUG_AMOX.id,
    });

    expect(prisma.domainEvent.create).toHaveBeenCalledOnce();
    const call = prisma.domainEvent.create.mock.calls[0]?.[0];
    expect(call?.data.eventType).toBe("pharmacy.allergy-detected");
    expect((call?.data.payload as { drugId: string }).drugId).toBe(DRUG_AMOX.id);
  });

  it("el evento outbox incluye el GTIN si se proporciona", async () => {
    prisma.drug.findFirst.mockResolvedValue(DRUG_AMOX as never);
    prisma.patientAllergy.findMany.mockResolvedValue([
      { id: uuid(20), substanceText: "Penicilina", severity: "severe", active: true },
    ] as never);
    prisma.allergyIntolerance.findMany.mockResolvedValue([] as never);
    prisma.domainEvent.create.mockResolvedValue({ id: uuid(99) } as never);

    await caller.dispense.checkAllergies({
      patientId: uuid(1),
      drugId: DRUG_AMOX.id,
      gtin: "01234567890128",
    });

    const call = prisma.domainEvent.create.mock.calls[0]?.[0];
    expect((call?.data.payload as { gtin: string }).gtin).toBe("01234567890128");
  });
});

describe("pharmacy.dispense.checkAllergies · warning", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let caller: ReturnType<typeof pharmacyRouter.createCaller>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);

    vi.mock("../../rls-context", () => ({
      withTenantContext: async (
        _prisma: unknown,
        _tenant: unknown,
        fn: (tx: unknown) => Promise<unknown>,
      ) => fn(_prisma),
    }));

    caller = pharmacyRouter.createCaller(makeCtx({ prisma: prisma as unknown as PrismaClient }));
  });

  it("devuelve warning cuando el paciente es alérgico a excipiente del drug", async () => {
    prisma.drug.findFirst.mockResolvedValue(DRUG_PARA as never);
    prisma.patientAllergy.findMany.mockResolvedValue([
      { id: uuid(21), substanceText: "Tartrazina", severity: "mild", active: true },
    ] as never);
    prisma.allergyIntolerance.findMany.mockResolvedValue([] as never);

    const result = await caller.dispense.checkAllergies({
      patientId: uuid(2),
      drugId: DRUG_PARA.id,
    });

    expect(result.status).toBe("warning");
    expect(result.matches[0]?.type).toBe("excipient");
  });

  it("NO publica evento outbox en warning (solo en hard stop)", async () => {
    prisma.drug.findFirst.mockResolvedValue(DRUG_PARA as never);
    prisma.patientAllergy.findMany.mockResolvedValue([
      { id: uuid(21), substanceText: "Tartrazina", severity: "mild", active: true },
    ] as never);
    prisma.allergyIntolerance.findMany.mockResolvedValue([] as never);

    await caller.dispense.checkAllergies({
      patientId: uuid(2),
      drugId: DRUG_PARA.id,
    });

    expect(prisma.domainEvent.create).not.toHaveBeenCalled();
  });
});

describe("pharmacy.dispense.checkAllergies · sin alertas", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let caller: ReturnType<typeof pharmacyRouter.createCaller>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);

    vi.mock("../../rls-context", () => ({
      withTenantContext: async (
        _prisma: unknown,
        _tenant: unknown,
        fn: (tx: unknown) => Promise<unknown>,
      ) => fn(_prisma),
    }));

    caller = pharmacyRouter.createCaller(makeCtx({ prisma: prisma as unknown as PrismaClient }));
  });

  it("devuelve ok cuando no hay matches de alergias", async () => {
    prisma.drug.findFirst.mockResolvedValue(DRUG_IBUP as never);
    prisma.patientAllergy.findMany.mockResolvedValue([] as never);
    prisma.allergyIntolerance.findMany.mockResolvedValue([] as never);

    const result = await caller.dispense.checkAllergies({
      patientId: uuid(3),
      drugId: DRUG_IBUP.id,
    });

    expect(result.status).toBe("ok");
    expect(result.matches).toHaveLength(0);
    expect(prisma.domainEvent.create).not.toHaveBeenCalled();
  });

  it("devuelve ok cuando el paciente tiene alergias pero no coinciden con el drug", async () => {
    prisma.drug.findFirst.mockResolvedValue(DRUG_IBUP as never);
    prisma.patientAllergy.findMany.mockResolvedValue([
      { id: uuid(20), substanceText: "Penicilina", severity: "severe", active: true },
      { id: uuid(21), substanceText: "Tartrazina", severity: "mild", active: true },
    ] as never);
    prisma.allergyIntolerance.findMany.mockResolvedValue([] as never);

    const result = await caller.dispense.checkAllergies({
      patientId: uuid(3),
      drugId: DRUG_IBUP.id,
    });

    expect(result.status).toBe("ok");
  });
});

describe("pharmacy.dispense.checkAllergies · errores", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let caller: ReturnType<typeof pharmacyRouter.createCaller>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);

    vi.mock("../../rls-context", () => ({
      withTenantContext: async (
        _prisma: unknown,
        _tenant: unknown,
        fn: (tx: unknown) => Promise<unknown>,
      ) => fn(_prisma),
    }));

    caller = pharmacyRouter.createCaller(makeCtx({ prisma: prisma as unknown as PrismaClient }));
  });

  it("lanza NOT_FOUND si el fármaco no existe en catálogo", async () => {
    prisma.drug.findFirst.mockResolvedValue(null as never);

    await expect(
      caller.dispense.checkAllergies({
        patientId: uuid(1),
        drugId: uuid(99),
      }),
    ).rejects.toThrow(TRPCError);
  });
});
