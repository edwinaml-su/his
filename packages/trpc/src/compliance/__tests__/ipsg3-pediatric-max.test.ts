/**
 * Compliance tests — JCI IPSG.3 ME 5
 * "Implement a process to reduce the risk of harm from high-alert medications."
 * Específicamente: bloqueo de dosis máxima pediátrica en BCMA.
 *
 * US.JCI.5.12 — Bloqueo de dosis máxima pediátrica en BCMA (mg/kg y tope absoluto).
 * Estrategia: función pura que replica la lógica del router; no requiere BD.
 */

// JCI Standard: IPSG.3 ME 5

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Tipos que espeja el router
// ---------------------------------------------------------------------------

interface PediatricMaxDoseLimit {
  max_dose_mg_per_kg: string | null;
  max_dose_absolute_mg: string | null;
}

interface PediatricCheckArgs {
  /** Dosis administrada en mg. */
  doseAmount: number;
  /** Fecha de nacimiento del paciente. null = no disponible (adulto o desconocido). */
  birthDate: Date | null;
  /** Peso del paciente en kg. null = sin peso reciente (últimas 24h). */
  pesoKg: number | null;
  /** Límite encontrado en ece.pediatric_max_dose. null = sin límite configurado. */
  limite: PediatricMaxDoseLimit | null;
}

interface PediatricCheckResult {
  blocked: false;
  noWeightWarning: boolean;
}

// ---------------------------------------------------------------------------
// Función pura — replica exacta de la lógica de recordBedsideAdmin IPSG.3 ME 5
// ---------------------------------------------------------------------------

function calcEdadMeses(birthDate: Date, now: Date): number {
  return (
    (now.getFullYear() - birthDate.getFullYear()) * 12 +
    (now.getMonth() - birthDate.getMonth())
  );
}

function runPediatricMaxDoseCheck(args: PediatricCheckArgs): PediatricCheckResult {
  const { doseAmount, birthDate, pesoKg, limite } = args;

  // Sin birthDate o sin límite configurado → no aplica validación
  if (!birthDate || !limite) {
    return { blocked: false, noWeightWarning: false };
  }

  const now = new Date();
  const edadMeses = calcEdadMeses(birthDate, now);

  // Sólo pacientes < 18 años (216 meses)
  if (edadMeses >= 216) {
    return { blocked: false, noWeightWarning: false };
  }

  // Sin peso reciente → warning, no bloquea
  if (pesoKg === null) {
    return { blocked: false, noWeightWarning: true };
  }

  const dosisCalculada = doseAmount / pesoKg;

  // Verificar mg/kg/dosis
  if (limite.max_dose_mg_per_kg !== null) {
    const maxMgPerKg = parseFloat(limite.max_dose_mg_per_kg);
    if (dosisCalculada > maxMgPerKg) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          `IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED: Dosis calculada ${dosisCalculada.toFixed(3)} mg/kg ` +
          `supera el límite pediátrico de ${maxMgPerKg} mg/kg para este medicamento.`,
        cause: {
          code: "IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED",
          maxDoseMgPerKg: maxMgPerKg,
          dosisCalculada,
        },
      });
    }
  }

  // Verificar tope absoluto
  if (limite.max_dose_absolute_mg !== null) {
    const maxAbsoluto = parseFloat(limite.max_dose_absolute_mg);
    if (doseAmount > maxAbsoluto) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          `IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED: Dosis absoluta ${doseAmount} mg ` +
          `supera el tope absoluto pediátrico de ${maxAbsoluto} mg.`,
        cause: {
          code: "IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED",
          maxDoseAbsoluteMg: maxAbsoluto,
          dosisCalculada,
        },
      });
    }
  }

  return { blocked: false, noWeightWarning: false };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-05-24T10:00:00Z");

/** Paciente adulto (25 años). */
function makeAdultBirthDate(): Date {
  return new Date("2001-01-01");
}

/** Paciente pediátrico (5 años = 60 meses). */
function makePediatricBirthDate5y(): Date {
  const d = new Date(NOW);
  d.setFullYear(d.getFullYear() - 5);
  return d;
}

/** Límite paracetamol: 15 mg/kg/dosis, tope absoluto 1000 mg. */
const LIMITE_PARACETAMOL: PediatricMaxDoseLimit = {
  max_dose_mg_per_kg: "15.000",
  max_dose_absolute_mg: "1000.000",
};

/** Límite midazolam IV: 0.1 mg/kg/dosis, tope absoluto 5 mg. */
const LIMITE_MIDAZOLAM: PediatricMaxDoseLimit = {
  max_dose_mg_per_kg: "0.100",
  max_dose_absolute_mg: "5.000",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IPSG.3 ME 5 — bloqueo de dosis máxima pediátrica en BCMA", () => {

  // -- Paciente adulto: sin validación pediátrica --------------------------------

  it("paciente adulto (≥18 años) → no bloquea aunque dosis sea alta", () => {
    // JCI IPSG.3 ME 5 — la validación pediátrica no aplica a adultos.
    const result = runPediatricMaxDoseCheck({
      doseAmount: 9999,
      birthDate: makeAdultBirthDate(),
      pesoKg: 70,
      limite: LIMITE_PARACETAMOL,
    });

    expect(result.blocked).toBe(false);
    expect(result.noWeightWarning).toBe(false);
  });

  // -- Paciente pediátrico + dosis dentro de límite → OK ------------------------

  it("pediátrico 5 años, 20 kg, paracetamol 280 mg (14 mg/kg < 15 mg/kg) → OK", () => {
    // JCI IPSG.3 ME 5 — dosis dentro del límite permite la administración.
    const result = runPediatricMaxDoseCheck({
      doseAmount: 280,     // 280 / 20 kg = 14 mg/kg < 15 mg/kg límite
      birthDate: makePediatricBirthDate5y(),
      pesoKg: 20,
      limite: LIMITE_PARACETAMOL,
    });

    expect(result.blocked).toBe(false);
    expect(result.noWeightWarning).toBe(false);
  });

  it("pediátrico 5 años, 20 kg, paracetamol exactamente en límite (300 mg = 15 mg/kg) → OK", () => {
    // El límite es estricto: > max bloquea, == max es permitido.
    const result = runPediatricMaxDoseCheck({
      doseAmount: 300,     // 300 / 20 kg = 15 mg/kg = exactamente el límite
      birthDate: makePediatricBirthDate5y(),
      pesoKg: 20,
      limite: LIMITE_PARACETAMOL,
    });

    expect(result.blocked).toBe(false);
    expect(result.noWeightWarning).toBe(false);
  });

  // -- Paciente pediátrico + dosis fuera de límite → PRECONDITION_FAILED ---------

  it("pediátrico 5 años, 20 kg, paracetamol 320 mg (16 mg/kg > 15 mg/kg) → PRECONDITION_FAILED", () => {
    // JCI IPSG.3 ME 5 — dosis en mg/kg supera el límite pediátrico documentado.
    expect(() =>
      runPediatricMaxDoseCheck({
        doseAmount: 320,   // 320 / 20 kg = 16 mg/kg > 15 mg/kg
        birthDate: makePediatricBirthDate5y(),
        pesoKg: 20,
        limite: LIMITE_PARACETAMOL,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED"),
      }),
    );
  });

  it("pediátrico, midazolam 6 mg supera tope absoluto de 5 mg → PRECONDITION_FAILED", () => {
    // JCI IPSG.3 ME 5 — el tope absoluto bloquea independientemente del peso.
    expect(() =>
      runPediatricMaxDoseCheck({
        doseAmount: 6,     // 6 mg > 5 mg tope absoluto
        birthDate: makePediatricBirthDate5y(),
        pesoKg: 70,        // peso alto pero el tope absoluto domina
        limite: LIMITE_MIDAZOLAM,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED"),
      }),
    );
  });

  it("error lanzado es instancia de TRPCError", () => {
    // JCI IPSG.3 ME 5 — el error debe ser TRPCError para que tRPC lo serialice correctamente.
    let caught: unknown;
    try {
      runPediatricMaxDoseCheck({
        doseAmount: 500,
        birthDate: makePediatricBirthDate5y(),
        pesoKg: 10,
        limite: LIMITE_PARACETAMOL, // 500/10 = 50 mg/kg > 15 → bloquea
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
  });

  // -- Paciente pediátrico sin peso registrado → warning (no bloquea) -----------

  it("pediátrico sin peso reciente → noWeightWarning=true, administración no bloqueada", () => {
    // JCI IPSG.3 ME 5 — sin peso, el sistema alerta pero no impide la administración.
    // El clínico (médico) es responsable de la decisión con el aviso visible.
    const result = runPediatricMaxDoseCheck({
      doseAmount: 500,
      birthDate: makePediatricBirthDate5y(),
      pesoKg: null,        // sin peso registrado en últimas 24h
      limite: LIMITE_PARACETAMOL,
    });

    expect(result.blocked).toBe(false);
    expect(result.noWeightWarning).toBe(true);
  });

  // -- Sin límite configurado para ese drug/edad/vía → no bloquea ---------------

  it("drug sin límite pediátrico en catálogo → no bloquea", () => {
    // Si el drug no está en ece.pediatric_max_dose, la validación no aplica.
    const result = runPediatricMaxDoseCheck({
      doseAmount: 9999,
      birthDate: makePediatricBirthDate5y(),
      pesoKg: 20,
      limite: null,  // sin registro en catálogo
    });

    expect(result.blocked).toBe(false);
    expect(result.noWeightWarning).toBe(false);
  });

  // -- Sin birthDate (dato no disponible) → no aplica ---------------------------

  it("birthDate null → no aplica validación pediátrica", () => {
    const result = runPediatricMaxDoseCheck({
      doseAmount: 9999,
      birthDate: null,
      pesoKg: 20,
      limite: LIMITE_PARACETAMOL,
    });

    expect(result.blocked).toBe(false);
    expect(result.noWeightWarning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// @QA — escenarios E2E adicionales (Playwright)
// ---------------------------------------------------------------------------
// @QA E2E (Playwright):
//   - Abrir flujo BCMA para paciente pediátrico (< 18 años) con peso reciente.
//   - Escanear paracetamol, ingresar dosis 320 mg para paciente de 20 kg → UI bloquea con mensaje IPSG3_PEDIATRIC_MAX_DOSE_EXCEEDED.
//   - Ingresar dosis 280 mg → flujo procede normalmente.
//   - Repetir para paciente sin peso en últimas 24h → UI muestra banner de advertencia pero permite continuar.
//   - Repetir para paciente adulto (mismo drug, alta dosis) → sin bloqueo pediátrico.
//   - Verificar que MedicationAdministration.noWeightWarning (campo response) llega al frontend.
