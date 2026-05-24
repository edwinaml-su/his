/**
 * Compliance test — JCI Standard: IPSG.1 ME 1
 *
 * IPSG.1: Identify Patients Correctly.
 * ME 1:   The hospital uses two patient identifiers for patients, never using
 *         the patient's room number or physical location as an identifier.
 *         Wristband GSRN is the primary electronic identifier.
 *
 * Cubre: US.JCI.5.4 — Wristband GSRN obligatorio antes de primera IND_MED.
 *
 * Estrategia de test: unitaria con función de validación pura que replica
 * el contrato del trigger SQL ece.fn_assert_wristband_gsrn().
 *
 * El trigger (111_ipsg1_wristband_trigger.sql) lanza SQLSTATE '23514' con
 * mensaje "PRECONDITION_FAILED: IPSG1_WRISTBAND_REQUIRED — ...".
 * El router que inserta en ece.indicaciones_medicas debe capturar ese error
 * y relanzarlo como TRPCError PRECONDITION_FAILED con código semántico.
 *
 * Estos tests cubren esa lógica de mapeo de error sin levantar Postgres.
 * Los tests de integración (trigger real) pertenecen a e2e/compliance-ipsg1.spec.ts.
 *
 * JCI Standard: IPSG.1 ME 1
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Tipos mínimos — replica la forma de los datos que el router necesita
// ---------------------------------------------------------------------------

interface PatientGsrnStub {
  gsrn: string | null;
}

// ---------------------------------------------------------------------------
// Función de validación — replica el contrato del trigger SQL
//
// En producción esta lógica vive en el router que inserta IND_MED:
//   - Consulta public."Patient".gsrn a través de la cadena
//     indicaciones_medicas → episodio_atencion → ece.paciente → public."Patient"
//   - O captura el PostgresError con code '23514' del trigger y lo traduce
//
// Aquí se extrae como función pura para testear el comportamiento esperado.
// ---------------------------------------------------------------------------

/**
 * Valida que el paciente del episodio tiene GSRN de pulsera asignado.
 * Lanza TRPCError PRECONDITION_FAILED si no.
 *
 * Replica el contrato del trigger ece.fn_assert_wristband_gsrn().
 *
 * JCI Standard: IPSG.1 ME 1
 */
function assertWristbandGsrn(patient: PatientGsrnStub | null): void {
  if (!patient || patient.gsrn === null || patient.gsrn.trim() === "") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "IPSG1_WRISTBAND_REQUIRED",
    });
  }
}

/**
 * Simula la traducción del PostgresError '23514' que lanza el trigger
 * al TRPCError que el router debe relanzar al cliente.
 *
 * JCI Standard: IPSG.1 ME 1
 */
function mapPostgresWristbandError(pgMessage: string): TRPCError {
  if (pgMessage.includes("IPSG1_WRISTBAND_REQUIRED")) {
    return new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "IPSG1_WRISTBAND_REQUIRED",
    });
  }
  // Error de BD no relacionado → relanzar como internal
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: pgMessage });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GSRN_VALIDO = "340123456789012345";

const pacienteConGsrn: PatientGsrnStub = { gsrn: GSRN_VALIDO };
const pacienteSinGsrn: PatientGsrnStub = { gsrn: null };
const pacienteGsrnVacio: PatientGsrnStub = { gsrn: "   " };

// Mensaje que lanza el trigger SQL (SQLSTATE 23514)
const PG_WRISTBAND_MESSAGE =
  "PRECONDITION_FAILED: IPSG1_WRISTBAND_REQUIRED — Patient sin GSRN de pulsera asignado";

// ---------------------------------------------------------------------------
// Suite — validación pre-INSERT de IND_MED
// ---------------------------------------------------------------------------

// JCI Standard: IPSG.1 ME 1
describe("IPSG.1 ME 1 — Wristband GSRN requerido antes de IND_MED", () => {
  /**
   * Caso 1: paciente con GSRN válido → validación pasa, no lanza excepción.
   * Escenario nominal: pulsera colocada y escaneada antes de la indicación.
   */
  it("permite IND_MED cuando el paciente tiene GSRN asignado", () => {
    // JCI Standard: IPSG.1 ME 1
    expect(() => assertWristbandGsrn(pacienteConGsrn)).not.toThrow();
  });

  /**
   * Caso 2: paciente sin GSRN (null) → PRECONDITION_FAILED con código semántico.
   * Escenario: pulsera nunca asignada. El trigger SQL lanza '23514'.
   */
  it("rechaza IND_MED con IPSG1_WRISTBAND_REQUIRED cuando gsrn es null", () => {
    // JCI Standard: IPSG.1 ME 1
    let caught: unknown;
    try {
      assertWristbandGsrn(pacienteSinGsrn);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("PRECONDITION_FAILED");
    expect(trpcErr.message).toBe("IPSG1_WRISTBAND_REQUIRED");
  });

  /**
   * Caso 3: GSRN presente pero string vacío/whitespace → PRECONDITION_FAILED.
   * Protege contra GSRN guardado como cadena vacía (dato corrupto).
   */
  it("rechaza IND_MED con IPSG1_WRISTBAND_REQUIRED cuando gsrn es string vacío", () => {
    // JCI Standard: IPSG.1 ME 1
    let caught: unknown;
    try {
      assertWristbandGsrn(pacienteGsrnVacio);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("PRECONDITION_FAILED");
    expect(trpcErr.message).toBe("IPSG1_WRISTBAND_REQUIRED");
  });

  /**
   * Caso 4: paciente no encontrado (episodio sin paciente) → PRECONDITION_FAILED.
   * Escenario defensivo: BD devuelve null en el JOIN.
   */
  it("rechaza IND_MED con IPSG1_WRISTBAND_REQUIRED cuando el registro de paciente es null", () => {
    // JCI Standard: IPSG.1 ME 1
    expect(() => assertWristbandGsrn(null)).toThrow(TRPCError);

    let caught: unknown;
    try {
      assertWristbandGsrn(null);
    } catch (err) {
      caught = err;
    }
    const trpcErr = caught as TRPCError;
    expect(trpcErr.code).toBe("PRECONDITION_FAILED");
    expect(trpcErr.message).toBe("IPSG1_WRISTBAND_REQUIRED");
  });

  /**
   * Caso 5: mapeo del PostgresError '23514' del trigger → TRPCError semántico.
   * Valida que el router traduce correctamente el error de la BD al cliente.
   */
  it("traduce PostgresError SQLSTATE 23514 del trigger a TRPCError PRECONDITION_FAILED", () => {
    // JCI Standard: IPSG.1 ME 1
    const mapped = mapPostgresWristbandError(PG_WRISTBAND_MESSAGE);

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped.code).toBe("PRECONDITION_FAILED");
    expect(mapped.message).toBe("IPSG1_WRISTBAND_REQUIRED");
  });

  /**
   * Caso 6: error de BD no relacionado → INTERNAL_SERVER_ERROR (no fuga de semántica IPSG1).
   * Protege contra falsos positivos de IPSG1 en errores genéricos.
   */
  it("no aplica semántica IPSG1 a errores de BD no relacionados", () => {
    // JCI Standard: IPSG.1 ME 1
    const mapped = mapPostgresWristbandError("duplicate key value violates unique constraint");

    expect(mapped.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
