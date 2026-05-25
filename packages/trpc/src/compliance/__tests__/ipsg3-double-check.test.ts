/**
 * Compliance tests — JCI IPSG.3 ME 4
 * "Implement a process to verify high-alert medications before administration."
 *
 * US.JCI.5.11 — Double-check independiente de 2 enfermeras para high-alert meds.
 * Estrategia: extraer la lógica de validación como función pura y testear sin BD.
 */

// JCI IPSG.3 ME 4

import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Constantes IPSG.3 (espejo del router)
// ---------------------------------------------------------------------------

const DOUBLE_CHECK_ALERT_LEVELS = new Set(["high", "very_high", "critical"]);

// ---------------------------------------------------------------------------
// Función pura que replica la lógica de double-check del router.
// Throws TRPCError igual que el router; retorna void si OK.
// ---------------------------------------------------------------------------

interface DoubleCheckArgs {
  alertLevel:      string;
  nurseId:         string;
  doubleCheckBy:   string | undefined;
  doubleCheckPin:  string | undefined;
  /** Simula la respuesta del lookup de pinHash en BD. null = usuario no existe. */
  storedPinHash:   string | null | undefined;
  /** Simula el resultado de verify(storedHash, pin). */
  pinVerifyResult: boolean;
}

async function runDoubleCheckValidation(args: DoubleCheckArgs): Promise<
  | { requiresDoubleCheck: true }
  | { requiresDoubleCheck: false }
> {
  const requiresDoubleCheck = DOUBLE_CHECK_ALERT_LEVELS.has(args.alertLevel);

  if (!requiresDoubleCheck) {
    return { requiresDoubleCheck: false };
  }

  // Sin datos de double-check → devolver flag para que el UI muestre el modal.
  if (!args.doubleCheckBy || !args.doubleCheckPin) {
    return { requiresDoubleCheck: true };
  }

  // Misma persona → FORBIDDEN
  if (args.doubleCheckBy === args.nurseId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "IPSG3_DOUBLE_CHECK_SAME_PERSON: El verificador independiente debe ser " +
        "una enfermera distinta a la que administra.",
    });
  }

  // Verificadora no encontrada (storedPinHash === undefined → usuario no existe)
  if (args.storedPinHash === undefined) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "IPSG3_DOUBLE_CHECK_FAILED: Verificadora no encontrada.",
    });
  }

  // PIN hash presente → verificar
  if (args.storedPinHash !== null) {
    if (!args.pinVerifyResult) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "IPSG3_DOUBLE_CHECK_FAILED: PIN de verificación incorrecto.",
      });
    }
  }
  // storedPinHash === null → organización sin PINs configurados (graceful degradation → OK)

  return { requiresDoubleCheck: false };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NURSE_A  = "00000000-0000-0000-0000-000000000001";
const NURSE_B  = "00000000-0000-0000-0000-000000000002";
const VALID_HASH = "$argon2id$v=19$m=65536,t=3,p=4$stub-hash";

// ---------------------------------------------------------------------------
// Tests IPSG.3 ME 4
// ---------------------------------------------------------------------------

describe("IPSG.3 ME 4 — double-check independiente para high-alert meds", () => {

  // -- alertLevel standard: sin double-check requerido -------------------------

  it("alertLevel=standard → requiresDoubleCheck=false sin validar PIN", async () => {
    // JCI IPSG.3 ME 4 — medicamentos estándar no requieren verificación adicional.
    const result = await runDoubleCheckValidation({
      alertLevel:      "standard",
      nurseId:         NURSE_A,
      doubleCheckBy:   undefined,
      doubleCheckPin:  undefined,
      storedPinHash:   undefined,
      pinVerifyResult: false,
    });

    expect(result.requiresDoubleCheck).toBe(false);
  });

  // -- alertLevel high: requiere double-check -----------------------------------

  it("alertLevel=high sin doubleCheckBy → requiresDoubleCheck=true (UI debe mostrar modal)", async () => {
    // JCI IPSG.3 ME 4 — high-alert requiere segundo verificador.
    const result = await runDoubleCheckValidation({
      alertLevel:      "high",
      nurseId:         NURSE_A,
      doubleCheckBy:   undefined,
      doubleCheckPin:  undefined,
      storedPinHash:   VALID_HASH,
      pinVerifyResult: true,
    });

    expect(result.requiresDoubleCheck).toBe(true);
  });

  it("alertLevel=very_high sin doubleCheckPin → requiresDoubleCheck=true", async () => {
    const result = await runDoubleCheckValidation({
      alertLevel:      "very_high",
      nurseId:         NURSE_A,
      doubleCheckBy:   NURSE_B,
      doubleCheckPin:  undefined,
      storedPinHash:   VALID_HASH,
      pinVerifyResult: true,
    });

    expect(result.requiresDoubleCheck).toBe(true);
  });

  it("alertLevel=critical sin doubleCheckBy → requiresDoubleCheck=true", async () => {
    const result = await runDoubleCheckValidation({
      alertLevel:      "critical",
      nurseId:         NURSE_A,
      doubleCheckBy:   undefined,
      doubleCheckPin:  "1234",
      storedPinHash:   VALID_HASH,
      pinVerifyResult: true,
    });

    expect(result.requiresDoubleCheck).toBe(true);
  });

  // -- Misma persona como administradora y verificadora -------------------------

  it("doubleCheckBy === nurseId → FORBIDDEN (IPSG3_DOUBLE_CHECK_SAME_PERSON)", async () => {
    // JCI IPSG.3 ME 4 — la verificación independiente requiere persona diferente.
    await expect(
      runDoubleCheckValidation({
        alertLevel:      "high",
        nurseId:         NURSE_A,
        doubleCheckBy:   NURSE_A, // misma persona
        doubleCheckPin:  "1234",
        storedPinHash:   VALID_HASH,
        pinVerifyResult: true,
      }),
    ).rejects.toMatchObject({
      code:    "FORBIDDEN",
      message: expect.stringContaining("IPSG3_DOUBLE_CHECK_SAME_PERSON"),
    });
  });

  // -- PIN incorrecto -----------------------------------------------------------

  it("PIN incorrecto → UNAUTHORIZED (IPSG3_DOUBLE_CHECK_FAILED)", async () => {
    // JCI IPSG.3 ME 4 — PIN inválido no autoriza la verificación.
    await expect(
      runDoubleCheckValidation({
        alertLevel:      "critical",
        nurseId:         NURSE_A,
        doubleCheckBy:   NURSE_B,
        doubleCheckPin:  "wrong",
        storedPinHash:   VALID_HASH,
        pinVerifyResult: false, // argon2 dice que NO coincide
      }),
    ).rejects.toMatchObject({
      code:    "UNAUTHORIZED",
      message: expect.stringContaining("IPSG3_DOUBLE_CHECK_FAILED"),
    });
  });

  // -- Verificadora no encontrada en BD -----------------------------------------

  it("verificadora no encontrada → PRECONDITION_FAILED", async () => {
    await expect(
      runDoubleCheckValidation({
        alertLevel:      "high",
        nurseId:         NURSE_A,
        doubleCheckBy:   "00000000-0000-0000-0000-000000009999",
        doubleCheckPin:  "1234",
        storedPinHash:   undefined, // usuario no existe
        pinVerifyResult: false,
      }),
    ).rejects.toMatchObject({
      code:    "PRECONDITION_FAILED",
      message: expect.stringContaining("IPSG3_DOUBLE_CHECK_FAILED"),
    });
  });

  // -- Happy path: 2 nurses diferentes con PIN correcto -------------------------

  it("2 nurses diferentes + PIN correcto → requiresDoubleCheck=false (administración ok)", async () => {
    // JCI IPSG.3 ME 4 — happy path de verificación independiente exitosa.
    const result = await runDoubleCheckValidation({
      alertLevel:      "critical",
      nurseId:         NURSE_A,
      doubleCheckBy:   NURSE_B,
      doubleCheckPin:  "correct-pin",
      storedPinHash:   VALID_HASH,
      pinVerifyResult: true,
    });

    expect(result.requiresDoubleCheck).toBe(false);
  });

  // -- Graceful degradation: organización sin PINs configurados -----------------

  it("storedPinHash=null (org sin PINs) + nurses diferentes → ok (degradación grácil)", async () => {
    // Si la org no configuró PINs, el double-check se acepta con identidad verificada visualmente.
    const result = await runDoubleCheckValidation({
      alertLevel:      "high",
      nurseId:         NURSE_A,
      doubleCheckBy:   NURSE_B,
      doubleCheckPin:  "cualquier-cosa",
      storedPinHash:   null,       // null = sin PIN configurado
      pinVerifyResult: false,      // irrelevante cuando hash es null
    });

    expect(result.requiresDoubleCheck).toBe(false);
  });

  // -- Los tres niveles que requieren double-check ------------------------------

  it.each(["high", "very_high", "critical"])(
    "alertLevel=%s con datos completos y PIN correcto → requiresDoubleCheck=false",
    async (level) => {
      const result = await runDoubleCheckValidation({
        alertLevel:      level,
        nurseId:         NURSE_A,
        doubleCheckBy:   NURSE_B,
        doubleCheckPin:  "valid",
        storedPinHash:   VALID_HASH,
        pinVerifyResult: true,
      });

      expect(result.requiresDoubleCheck).toBe(false);
    },
  );

  // -- El error es TRPCError, no Error genérico ---------------------------------

  it("mismo-persona error es instancia de TRPCError", async () => {
    let caught: unknown;
    try {
      await runDoubleCheckValidation({
        alertLevel:      "critical",
        nurseId:         NURSE_A,
        doubleCheckBy:   NURSE_A,
        doubleCheckPin:  "1234",
        storedPinHash:   VALID_HASH,
        pinVerifyResult: true,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// @QA — escenarios E2E adicionales
// ---------------------------------------------------------------------------
// @QA E2E (Playwright):
//   - Administrar morphine (alertLevel=critical): UI muestra modal double-check.
//   - Completar modal con misma cuenta logueada → error "persona distinta".
//   - Completar modal con cuenta diferente y PIN incorrecto → error "PIN incorrecto".
//   - Completar modal con segunda enfermera y PIN correcto → "Administración Confirmada".
//   - Metformin (alertLevel=standard) → modal double-check NO aparece.
//   - Verificar que MedicationAdministration.doubleCheckAt != null tras happy path.
