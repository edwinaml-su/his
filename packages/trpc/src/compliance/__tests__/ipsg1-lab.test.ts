/**
 * Compliance test — IPSG.1 ME 4: Toma de muestra de laboratorio bedside
 * con verificación de 2 identificadores del paciente.
 *
 * JCI Standard: IPSG.1 ME 4
 * Standard: "The organization identifies situations in which additional
 * patient identification requirements are applied" — toma de muestras
 * se clasifica como procedimiento de mayor riesgo.
 *
 * Decisión de implementación: se inyectan `patientGsrn` y `secondIdentifier`
 * en el input de `specimen.collect` existente (no se creó procedure separado).
 * Cuando ninguno viene, el flujo legacy sin pulsera sigue funcionando.
 *
 * Cubre:
 *   1. Happy path — GSRN + MRN correctos → specimen creado
 *   2. Happy path — GSRN + PatientIdentifier (DUI) correcto → specimen creado
 *   3. Mismatch GSRN — pulsera equivocada → FORBIDDEN
 *   4. Mismatch segundo ID — MRN incorrecto → FORBIDDEN
 *   5. Sin segundo ID con GSRN presente → BAD_REQUEST
 *   6. Sin GSRN — flujo legacy sin validación 2-IDs → no lanza
 */
import { describe, it, expect } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { lisRouter } from "../../routers/lis.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORDER_ID  = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
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

/** Patient con los campos necesarios para verificación 2-IDs. */
const MOCK_PATIENT = {
  gsrn:        GSRN_CORRECTO,
  mrn:         MRN_CORRECTO,
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// JCI Standard: IPSG.1 ME 4
describe("IPSG.1 ME 4 — specimen.collect bedside: 2 identificadores", () => {
  it("happy path: GSRN correcto + MRN correcto → crea specimen", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    const result = await lisRouter
      .createCaller(makeCtx({ prisma }))
      .specimen.collect({
        orderId:          ORDER_ID,
        type:             "BLOOD",
        barcode:          "BC-001",
        patientGsrn:      GSRN_CORRECTO,
        secondIdentifier: MRN_CORRECTO,
      });

    expect(result).toMatchObject({ condition: "ACCEPTABLE" });
  });

  it("happy path: GSRN correcto + DUI (PatientIdentifier) correcto → crea specimen", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    const result = await lisRouter
      .createCaller(makeCtx({ prisma }))
      .specimen.collect({
        orderId:          ORDER_ID,
        type:             "BLOOD",
        barcode:          "BC-002",
        patientGsrn:      GSRN_CORRECTO,
        secondIdentifier: DUI_CORRECTO,
      });

    expect(result).toMatchObject({ condition: "ACCEPTABLE" });
  });

  it("mismatch GSRN: pulsera equivocada → FORBIDDEN", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    // JCI Standard: IPSG.1 ME 4 — primer ID incorrecto debe bloquear.
    // El patient tiene GSRN_CORRECTO; el input envía GSRN_INCORRECTO.
    await expect(
      lisRouter.createCaller(makeCtx({ prisma })).specimen.collect({
        orderId:          ORDER_ID,
        type:             "BLOOD",
        barcode:          "BC-003",
        patientGsrn:      GSRN_INCORRECTO,
        secondIdentifier: MRN_CORRECTO,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("mismatch segundo ID: MRN incorrecto → FORBIDDEN", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    // JCI Standard: IPSG.1 ME 4 — segundo ID incorrecto debe bloquear
    await expect(
      lisRouter.createCaller(makeCtx({ prisma })).specimen.collect({
        orderId:          ORDER_ID,
        type:             "BLOOD",
        barcode:          "BC-004",
        patientGsrn:      GSRN_CORRECTO,
        secondIdentifier: "MRN-INCORRECTO-999",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("GSRN presente pero sin segundo ID → BAD_REQUEST", async () => {
    const prisma = makePrisma();
    setupOrderFound(prisma);

    // JCI Standard: IPSG.1 ME 4 — ambos IDs son obligatorios en flujo bedside
    await expect(
      lisRouter.createCaller(makeCtx({ prisma })).specimen.collect({
        orderId:     ORDER_ID,
        type:        "BLOOD",
        barcode:     "BC-005",
        patientGsrn: GSRN_CORRECTO,
        // secondIdentifier ausente intencionalmente
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("sin GSRN (flujo legacy lab sin pulsera) → crea specimen sin validación 2-IDs", async () => {
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
  });
});
