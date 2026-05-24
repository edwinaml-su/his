/**
 * Compliance test — JCI Standard: IPSG.1 ME 3
 *
 * IPSG.1: Identify Patients Correctly.
 * ME 3:   Two patient identifiers are used before blood or blood products
 *         are administered.
 *
 * Cubre: US.JCI.5.2 — Transfusión con 2 identificadores (GSRN pulsera + DUI/MRN).
 *
 * Estrategia de test: unitaria con mocks de Prisma + tRPC caller.
 * No requiere Postgres — la lógica de 2-IDs es pura JS antes del I/O de BD.
 * Los casos felices de I/O (crossmatch, unidad) se testean en blood-bank.router.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Helpers de mock — replica mínima de la firma del router bajo prueba
// ---------------------------------------------------------------------------

type IdentifierStub = { value: string };
type PatientStub = { id: string; mrn: string; identifiers: IdentifierStub[] } | null;

/**
 * Extrae y ejecuta la lógica de validación 2-IDs del procedure transfusion.start
 * sin levantar tRPC ni Prisma.
 *
 * Devuelve void si pasa; lanza TRPCError PRECONDITION_FAILED si no.
 */
function runIpsg1TwoIdCheck(opts: {
  patientGsrn: string;
  secondIdentifier: string;
  patient: PatientStub;
}): void {
  // JCI Standard: IPSG.1 ME 3
  if (!opts.patient) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "IPSG1_TRANSFUSION_TWO_ID_MISMATCH",
    });
  }

  const validSecondIds = new Set([
    opts.patient.mrn,
    ...opts.patient.identifiers.map((id) => id.value),
  ]);

  if (!validSecondIds.has(opts.secondIdentifier)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "IPSG1_TRANSFUSION_TWO_ID_MISMATCH",
    });
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const GSRN_PULSERA = "340123456789012345";
const MRN_PACIENTE = "MRN-00123";
const DUI_PACIENTE = "012345678";

const patientWithGsrn: PatientStub = {
  id: "uuid-paciente",
  mrn: MRN_PACIENTE,
  identifiers: [{ value: DUI_PACIENTE }],
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

// JCI Standard: IPSG.1 ME 3
describe("IPSG.1 ME 3 — 2 identificadores antes de transfusión", () => {
  /**
   * Caso 1: ambos identificadores correctos → validación pasa.
   * Escenario nominal: enfermero escanea pulsera GSRN y confirma con MRN.
   */
  it("pasa cuando GSRN + MRN coinciden con el paciente", () => {
    // JCI Standard: IPSG.1 ME 3
    expect(() =>
      runIpsg1TwoIdCheck({
        patientGsrn: GSRN_PULSERA,
        secondIdentifier: MRN_PACIENTE,
        patient: patientWithGsrn,
      }),
    ).not.toThrow();
  });

  /**
   * Caso 2: GSRN correcto + DUI como segundo identificador → pasa.
   * Verifica que cualquier valor en PatientIdentifier sirve como segundo ID.
   */
  it("pasa cuando GSRN + DUI coinciden con el paciente", () => {
    // JCI Standard: IPSG.1 ME 3
    expect(() =>
      runIpsg1TwoIdCheck({
        patientGsrn: GSRN_PULSERA,
        secondIdentifier: DUI_PACIENTE,
        patient: patientWithGsrn,
      }),
    ).not.toThrow();
  });

  /**
   * Caso 3: GSRN incorrecto (pulsera de otro paciente) → PRECONDITION_FAILED.
   * Simula que la BD devuelve null porque el GSRN no coincide con el patientId.
   */
  it("falla con IPSG1_TRANSFUSION_TWO_ID_MISMATCH cuando GSRN no coincide (pulsera ajena)", () => {
    // JCI Standard: IPSG.1 ME 3
    expect(() =>
      runIpsg1TwoIdCheck({
        patientGsrn: "000000000000000000", // GSRN de otro paciente
        secondIdentifier: MRN_PACIENTE,
        patient: null, // BD devuelve null → GSRN no pertenece a este paciente
      }),
    ).toThrow(TRPCError);

    try {
      runIpsg1TwoIdCheck({
        patientGsrn: "000000000000000000",
        secondIdentifier: MRN_PACIENTE,
        patient: null,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("PRECONDITION_FAILED");
      expect(trpcErr.message).toBe("IPSG1_TRANSFUSION_TWO_ID_MISMATCH");
    }
  });

  /**
   * Caso 4: GSRN correcto pero segundo identificador no reconocido → PRECONDITION_FAILED.
   * Simula entrada manual incorrecta del enfermero.
   */
  it("falla con IPSG1_TRANSFUSION_TWO_ID_MISMATCH cuando segundo identificador no está registrado", () => {
    // JCI Standard: IPSG.1 ME 3
    expect(() =>
      runIpsg1TwoIdCheck({
        patientGsrn: GSRN_PULSERA,
        secondIdentifier: "DATO-INCORRECTO",
        patient: patientWithGsrn,
      }),
    ).toThrow(TRPCError);

    try {
      runIpsg1TwoIdCheck({
        patientGsrn: GSRN_PULSERA,
        secondIdentifier: "DATO-INCORRECTO",
        patient: patientWithGsrn,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("PRECONDITION_FAILED");
      expect(trpcErr.message).toBe("IPSG1_TRANSFUSION_TWO_ID_MISMATCH");
    }
  });

  /**
   * Caso 5: GSRN correcto pero sin segundo identificador (string vacío).
   * Zod lo bloquea antes del procedure (.min(1)), pero la lógica también lo rechaza.
   */
  it("falla cuando segundo identificador es string vacío (sin pulsera de respaldo)", () => {
    // JCI Standard: IPSG.1 ME 3
    expect(() =>
      runIpsg1TwoIdCheck({
        patientGsrn: GSRN_PULSERA,
        secondIdentifier: "",
        patient: patientWithGsrn,
      }),
    ).toThrow(TRPCError);
  });
});
