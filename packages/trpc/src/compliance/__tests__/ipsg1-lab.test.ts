/**
 * Compliance test — IPSG.1 ME 4 (IPSG.1-H1): Toma de muestra de laboratorio
 * bedside con verificación de 2 identificadores del paciente y persistencia.
 *
 * JCI Standard: IPSG.1 ME 4
 * Standard: "The organization identifies situations in which additional
 * patient identification requirements are applied" — toma de muestras
 * se clasifica como procedimiento de mayor riesgo.
 *
 * IPSG.1-H1 (2026-05-30): además de validar en runtime, se persiste la
 * evidencia de la verificación (gsrnPacienteVerificado, identifier2Kind,
 * identifier2Value, verifiedAt, verifiedBy) en LabSpecimen y se emite
 * el evento jci.ipsg1.lab_bedside_verified.
 *
 * Decisión de implementación: se inyectan `patientGsrn`, `identifier2Kind`
 * y `secondIdentifier` en el input de `specimen.collect` existente.
 * Cuando ninguno viene, el flujo legacy sin pulsera sigue funcionando.
 *
 * Cubre:
 *   1. Happy path — GSRN + MRN (kind=MRN) → specimen con verifiedAt persistido
 *   2. Happy path — GSRN + DUI (kind=DUI) → specimen con verifiedAt persistido
 *   3. Mismatch GSRN — pulsera equivocada → PRECONDITION_FAILED
 *   4. Mismatch segundo ID — MRN incorrecto → PRECONDITION_FAILED
 *   5. Sin segundo ID con GSRN presente → BAD_REQUEST
 *   6. Sin GSRN — flujo legacy sin pulsera → crea specimen sin verifiedAt
 *   7. identifier2Kind ausente con GSRN presente → BAD_REQUEST
 *   8. identifier2Kind fuera del enum válido → ZodError (parse)
 */
import { describe, it, expect } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { specimenCollectInput } from "@his/contracts";
import { lisRouter } from "../../routers/lis.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORDER_ID   = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PATIENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// JCI Standard: IPSG.1 ME 4
const GSRN_CORRECTO   = "100000000000000003"; // 18 dígitos
const GSRN_INCORRECTO = "999999999999999990";
const MRN_CORRECTO    = "MRN-2026-001";
const DUI_CORRECTO    = "01234567-8";

/** Orden (solo scalars — LabOrder no tiene relación patient en schema). */
const MOCK_ORDER = {
  id:        ORDER_ID,
  patientId: PATIENT_ID,
};

/** Patient con los campos necesarios para verificación 2-IDs (IPSG.1-H1). */
const MOCK_PATIENT = {
  gsrn:        GSRN_CORRECTO,
  mrn:         MRN_CORRECTO,
  firstName:   "María",
  lastName:    "García López",
  birthDate:   new Date("1990-03-15"),
  identifiers: [{ value: DUI_CORRECTO }],
};

/** Specimen stub que devuelve tx.labSpecimen.create */
const MOCK_SPECIMEN = { id: "spec-1", orderId: ORDER_ID, condition: "ACCEPTABLE" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  // withTenantContext hace $transaction internamente — el mock lo pasa directo.
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRaw.mockResolvedValue(0 as never);
  return prisma;
}

function setupOrderFound(
  prisma: DeepMockProxy<PrismaClient>,
  patientOverride?: Partial<typeof MOCK_PATIENT> | null,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.labOrder.findFirst as any).mockResolvedValue(MOCK_ORDER);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.patient.findFirst as any).mockResolvedValue(
    patientOverride === null ? null : { ...MOCK_PATIENT, ...patientOverride },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.labSpecimen.create as any).mockResolvedValue(MOCK_SPECIMEN);
  // emitDomainEvent usa domainEvent.create — stub para no fallar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.domainEvent.create as any).mockResolvedValue({});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// JCI Standard: IPSG.1 ME 4 / IPSG.1-H1
describe("IPSG.1 ME 4 — specimen.collect bedside: 2 identificadores + persistencia", () => {
  it("happy path: GSRN correcto + MRN (kind=MRN) → specimen creado con verifiedAt persistido", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    const result = await lisRouter
      .createCaller(makeCtx({ prisma }))
      .specimen.collect({
        orderId:          ORDER_ID,
        type:             "BLOOD",
        barcode:          "BC-001",
        patientGsrn:      GSRN_CORRECTO,
        identifier2Kind:  "MRN",
        secondIdentifier: MRN_CORRECTO,
      });

    expect(result).toMatchObject({ condition: "ACCEPTABLE" });
    // IPSG.1-H1: verificar que se persistió la evidencia de verificación.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createArg = (prisma.labSpecimen.create as any).mock.calls[0][0];
    expect(createArg.data.gsrnPacienteVerificado).toBe(GSRN_CORRECTO);
    expect(createArg.data.identifier2Kind).toBe("MRN");
    expect(createArg.data.identifier2Value).toBe(MRN_CORRECTO);
    expect(createArg.data.verifiedAt).toBeInstanceOf(Date);
    expect(createArg.data.verifiedBy).toBeDefined();
  });

  it("happy path: GSRN correcto + DUI (kind=DUI) → specimen creado con verifiedAt persistido", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    const result = await lisRouter
      .createCaller(makeCtx({ prisma }))
      .specimen.collect({
        orderId:          ORDER_ID,
        type:             "BLOOD",
        barcode:          "BC-002",
        patientGsrn:      GSRN_CORRECTO,
        identifier2Kind:  "DUI",
        secondIdentifier: DUI_CORRECTO,
      });

    expect(result).toMatchObject({ condition: "ACCEPTABLE" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createArg = (prisma.labSpecimen.create as any).mock.calls[0][0];
    expect(createArg.data.identifier2Kind).toBe("DUI");
    expect(createArg.data.identifier2Value).toBe(DUI_CORRECTO);
  });

  it("mismatch GSRN: pulsera equivocada → PRECONDITION_FAILED", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    // IPSG.1-H1 — primer ID incorrecto debe bloquear con PRECONDITION_FAILED.
    await expect(
      lisRouter.createCaller(makeCtx({ prisma })).specimen.collect({
        orderId:          ORDER_ID,
        type:             "BLOOD",
        barcode:          "BC-003",
        patientGsrn:      GSRN_INCORRECTO,
        identifier2Kind:  "MRN",
        secondIdentifier: MRN_CORRECTO,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("mismatch segundo ID: MRN incorrecto → PRECONDITION_FAILED", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    // IPSG.1-H1 — segundo ID incorrecto debe bloquear con PRECONDITION_FAILED.
    await expect(
      lisRouter.createCaller(makeCtx({ prisma })).specimen.collect({
        orderId:          ORDER_ID,
        type:             "BLOOD",
        barcode:          "BC-004",
        patientGsrn:      GSRN_CORRECTO,
        identifier2Kind:  "MRN",
        secondIdentifier: "MRN-INCORRECTO-999",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("GSRN presente pero sin segundo ID → BAD_REQUEST", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    // Ambos IDs son obligatorios en flujo bedside.
    await expect(
      lisRouter.createCaller(makeCtx({ prisma })).specimen.collect({
        orderId:         ORDER_ID,
        type:            "BLOOD",
        barcode:         "BC-005",
        patientGsrn:     GSRN_CORRECTO,
        identifier2Kind: "MRN",
        // secondIdentifier ausente intencionalmente
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("sin GSRN (flujo legacy lab sin pulsera) → crea specimen sin verifiedAt", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    // Flujo no-bedside: lab recibe muestra directa, sin pulsera — sigue funcionando.
    const result = await lisRouter
      .createCaller(makeCtx({ prisma }))
      .specimen.collect({
        orderId: ORDER_ID,
        type:    "BLOOD",
        barcode: "BC-006",
      });

    expect(result).toMatchObject({ condition: "ACCEPTABLE" });
    // No debe haber campos de verificación en el create.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createArg = (prisma.labSpecimen.create as any).mock.calls[0][0];
    expect(createArg.data.verifiedAt).toBeUndefined();
    expect(createArg.data.gsrnPacienteVerificado).toBeUndefined();
  });

  it("GSRN presente pero identifier2Kind ausente → BAD_REQUEST", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    // IPSG.1-H1: identifier2Kind es obligatorio junto con el GSRN de pulsera.
    await expect(
      lisRouter.createCaller(makeCtx({ prisma })).specimen.collect({
        orderId:          ORDER_ID,
        type:             "BLOOD",
        barcode:          "BC-007",
        patientGsrn:      GSRN_CORRECTO,
        secondIdentifier: MRN_CORRECTO,
        // identifier2Kind ausente intencionalmente
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("identifier2Kind con valor fuera de enum → error de parsing Zod", () => {
    // El schema Zod debe rechazar kinds no reconocidos antes de llegar al router.
    const result = specimenCollectInput.safeParse({
      orderId:          ORDER_ID,
      type:             "BLOOD",
      barcode:          "BC-008",
      patientGsrn:      GSRN_CORRECTO,
      identifier2Kind:  "PASAPORTE", // no es uno de los 4 válidos
      secondIdentifier: "P12345678",
    });
    expect(result.success).toBe(false);
  });
});
