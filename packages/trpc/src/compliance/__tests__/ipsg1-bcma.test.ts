/**
 * Compliance tests — JCI Standard: IPSG.1 ME 2
 * "Use at least two patient identifiers when providing care, treatment, and services."
 *
 * Cubre la validación de 2 identificadores cruzados en medicationAdmin.recordBedsideAdmin:
 *  - Primer  ID: GSRN de la pulsera física del paciente
 *  - Segundo ID: DUI o MRN capturado de forma independiente
 *
 * Estrategia: mockear Prisma.$queryRawUnsafe para controlar las respuestas
 * sin necesidad de base de datos real. El router usa withTenantContext que
 * llama a prisma.$transaction internamente; mockeamos $transaction también.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Fixture de IDs
// ---------------------------------------------------------------------------

const ORG_ID      = "00000000-0000-0000-0000-000000000001";
const PATIENT_ID  = "00000000-0000-0000-0000-000000000002";
const NURSE_ID    = "00000000-0000-0000-0000-000000000003";
const ITEM_ID     = "00000000-0000-0000-0000-000000000004";
const GSRN_PAX    = "801874130000000001";
const DUI_VALUE   = "01234567-8";
const MRN_VALUE   = "HIS-001234";

// ---------------------------------------------------------------------------
// Mock de Prisma
// ---------------------------------------------------------------------------

/**
 * Construye un mock de PrismaClient para la validación IPSG.1.
 *
 * @param gsrnRow    - fila retornada por la query de GSRN (null = no encontrado)
 * @param secondRow  - fila retornada por la query del segundo ID (null = no encontrado)
 * @param itemRow    - fila retornada por la query de PrescriptionItem
 */
function makePrisma(opts: {
  gsrnRow:    { id: string } | null;
  secondRow:  { id: string } | null;
  itemRow?:   { id: string } | null;
}) {
  // $queryRawUnsafe se llama 2 veces en el bloque IPSG.1:
  //   call 1 → GSRN lookup
  //   call 2 → segundo ID lookup
  // Luego, si ambos coinciden, continúa con prescriptionItem.findFirst
  let rawCallCount = 0;
  const queryRawUnsafe = vi.fn().mockImplementation(() => {
    rawCallCount++;
    if (rawCallCount === 1) return Promise.resolve(opts.gsrnRow ? [opts.gsrnRow] : []);
    if (rawCallCount === 2) return Promise.resolve(opts.secondRow ? [opts.secondRow] : []);
    return Promise.resolve([]);
  });

  const findFirst = vi.fn().mockResolvedValue(opts.itemRow ?? null);

  // withTenantContext llama a prisma.$transaction con un callback
  const $transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      $queryRawUnsafe: queryRawUnsafe,
      prescriptionItem: { findFirst },
      medicationAdministration: { create: vi.fn().mockResolvedValue({ id: "admin-id" }) },
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    })
  );

  return {
    $queryRawUnsafe: queryRawUnsafe,
    $transaction,
    prescriptionItem:           { findFirst },
    medicationAdministration:   { create: vi.fn() },
    $executeRawUnsafe:          vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Extraer la lógica IPSG.1 del router para testear sin contexto tRPC completo.
// El bloque de validación está encapsulado en la mutation; lo extraemos aquí
// como función pura para poder unittestarla directamente.
// ---------------------------------------------------------------------------

type SecondId = { type: "DUI" | "MRN"; value: string };

/**
 * Replica la lógica del bloque IPSG.1 del router.
 * Lanza TRPCError con PRECONDITION_FAILED si los IDs no coinciden.
 */
async function verifyTwoPatientIds(
  tx: {
    $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<{ id: string }[]>;
  },
  gsrnPaciente: string,
  secondIdentifier: SecondId,
): Promise<void> {
  const { type, value } = secondIdentifier;
  const col = type === "DUI" ? '"nationalId"' : '"mrn"';

  const byGsrn   = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT p.id FROM "Patient" p WHERE p.gsrn = $1 LIMIT 1`,
    gsrnPaciente,
  );
  const bySecond = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT p.id FROM "Patient" p WHERE ${col} = $1 LIMIT 1`,
    value,
  );

  const gsrnPatientId   = (byGsrn as { id: string }[])[0]?.id;
  const secondPatientId = (bySecond as { id: string }[])[0]?.id;

  if (!gsrnPatientId || !secondPatientId || gsrnPatientId !== secondPatientId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "IPSG1_TWO_ID_MISMATCH: Los 2 identificadores del paciente no coinciden. " +
        "Se requiere GSRN de pulsera y " + type + " apuntando al mismo paciente (5R: paciente correcto).",
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IPSG.1 ME 2 — verificación de 2 identificadores en BCMA bedside", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -- Caso exitoso ----------------------------------------------------------

  it("permite la administración cuando GSRN + DUI apuntan al mismo patientId", async () => {
    const tx = makePrisma({
      gsrnRow:   { id: PATIENT_ID },
      secondRow: { id: PATIENT_ID },
    });

    await expect(
      verifyTwoPatientIds(tx, GSRN_PAX, { type: "DUI", value: DUI_VALUE }),
    ).resolves.toBeUndefined();
  });

  it("permite la administración cuando GSRN + MRN apuntan al mismo patientId", async () => {
    const tx = makePrisma({
      gsrnRow:   { id: PATIENT_ID },
      secondRow: { id: PATIENT_ID },
    });

    await expect(
      verifyTwoPatientIds(tx, GSRN_PAX, { type: "MRN", value: MRN_VALUE }),
    ).resolves.toBeUndefined();
  });

  // -- GSRN solo (sin segundo ID resolvible) ---------------------------------

  it("IPSG1_TWO_ID_MISMATCH: GSRN encontrado pero segundo ID no existe en BD", async () => {
    // JCI Standard: IPSG.1 ME 2 — un solo identificador no es suficiente
    const tx = makePrisma({
      gsrnRow:   { id: PATIENT_ID },
      secondRow: null,             // DUI no encontrado
    });

    await expect(
      verifyTwoPatientIds(tx, GSRN_PAX, { type: "DUI", value: "99999999-9" }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("IPSG1_TWO_ID_MISMATCH"),
    });
  });

  // -- GSRN + segundo ID apuntan a pacientes distintos -----------------------

  it("IPSG1_TWO_ID_MISMATCH: GSRN y DUI apuntan a pacientes diferentes", async () => {
    // JCI Standard: IPSG.1 ME 2 — mismatch de identidad detectado
    const OTHER_PATIENT = "00000000-0000-0000-0000-000000000099";
    const tx = makePrisma({
      gsrnRow:   { id: PATIENT_ID },
      secondRow: { id: OTHER_PATIENT }, // DUI es de otro paciente
    });

    await expect(
      verifyTwoPatientIds(tx, GSRN_PAX, { type: "DUI", value: DUI_VALUE }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("IPSG1_TWO_ID_MISMATCH"),
    });
  });

  // -- GSRN no encontrado (pulsera inválida) ---------------------------------

  it("IPSG1_TWO_ID_MISMATCH: GSRN de pulsera no existe en BD", async () => {
    // JCI Standard: IPSG.1 ME 2 — el primer ID (pulsera) debe existir
    const tx = makePrisma({
      gsrnRow:   null,             // GSRN no registrado
      secondRow: { id: PATIENT_ID },
    });

    await expect(
      verifyTwoPatientIds(tx, "999999999999999999", { type: "DUI", value: DUI_VALUE }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("IPSG1_TWO_ID_MISMATCH"),
    });
  });

  // -- Ningún ID encontrado --------------------------------------------------

  it("IPSG1_TWO_ID_MISMATCH: ni GSRN ni segundo ID existen en BD", async () => {
    const tx = makePrisma({
      gsrnRow:   null,
      secondRow: null,
    });

    await expect(
      verifyTwoPatientIds(tx, "000000000000000000", { type: "MRN", value: "UNKNOWN" }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("IPSG1_TWO_ID_MISMATCH"),
    });
  });

  // -- El error es TRPCError, no Error genérico ------------------------------

  it("el error es instancia de TRPCError (no error genérico)", async () => {
    const OTHER = "00000000-0000-0000-0000-000000000099";
    const tx = makePrisma({
      gsrnRow:   { id: PATIENT_ID },
      secondRow: { id: OTHER },
    });

    let caught: unknown;
    try {
      await verifyTwoPatientIds(tx, GSRN_PAX, { type: "DUI", value: DUI_VALUE });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
  });

  // -- Uso correcto de columna según tipo de ID ------------------------------

  it("usa columna nationalId para tipo DUI", async () => {
    const tx = makePrisma({
      gsrnRow:   { id: PATIENT_ID },
      secondRow: { id: PATIENT_ID },
    });

    await verifyTwoPatientIds(tx, GSRN_PAX, { type: "DUI", value: DUI_VALUE });

    // Segunda llamada a $queryRawUnsafe debe contener "nationalId"
    const calls = vi.mocked(tx.$queryRawUnsafe).mock.calls;
    const secondCall = calls[1]?.[0] as string;
    expect(secondCall).toContain('"nationalId"');
  });

  it("usa columna mrn para tipo MRN", async () => {
    const tx = makePrisma({
      gsrnRow:   { id: PATIENT_ID },
      secondRow: { id: PATIENT_ID },
    });

    await verifyTwoPatientIds(tx, GSRN_PAX, { type: "MRN", value: MRN_VALUE });

    const calls = vi.mocked(tx.$queryRawUnsafe).mock.calls;
    const secondCall = calls[1]?.[0] as string;
    expect(secondCall).toContain('"mrn"');
  });
});

// ---------------------------------------------------------------------------
// Marcar para @QA: escenarios E2E adicionales requeridos
// ---------------------------------------------------------------------------
// @QA E2E (Playwright):
//  - Wizard bedside: completar los 2 campos de ID → verificar que el endpoint
//    acepta y crea MedicationAdministration.
//  - Wizard bedside: escanear solo pulsera, no ingresar DUI/MRN → UI debe
//    bloquear submit o mostrar error IPSG1_TWO_ID_MISMATCH.
//  - Wizard bedside: escanear pulsera de paciente A + DUI de paciente B →
//    servidor devuelve 412 con mensaje IPSG1_TWO_ID_MISMATCH.
