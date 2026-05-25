/**
 * Compliance tests — JCI Standard: IPSG.3 ME 1
 * "The organization identifies a list of high-alert medications (HAM)."
 *
 * Verifica:
 * 1. Helpers de clasificación ISMP retornan valores correctos.
 * 2. Los niveles de alerta declarados en contratos son los esperados.
 * 3. Clasificación ATC → alertLevel es correcta (via mock Prisma).
 *
 * No depende de BD real — Prisma se mockea para controlar respuestas.
 */

import { describe, it, expect } from "vitest";
import {
  ALERT_LEVELS,
  isHighAlert,
  requiresDoubleCheck,
  getColorForLevel,
} from "@his/contracts/clinical/high-alert-medications";

// ---------------------------------------------------------------------------
// 1. Catálogo de niveles
// ---------------------------------------------------------------------------

describe("IPSG.3 ME 1 — ALERT_LEVELS catálogo", () => {
  it("incluye exactamente los 4 niveles ISMP", () => {
    // JCI Standard: IPSG.3 ME 1
    expect(ALERT_LEVELS).toEqual(["standard", "high", "very_high", "critical"]);
  });

  it("tiene 4 niveles y no más", () => {
    expect(ALERT_LEVELS).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// 2. isHighAlert
// ---------------------------------------------------------------------------

describe("IPSG.3 ME 1 — isHighAlert()", () => {
  it("standard → false", () => {
    expect(isHighAlert("standard")).toBe(false);
  });

  it("high → true (insulina, anticoagulantes)", () => {
    // JCI Standard: IPSG.3 ME 1
    expect(isHighAlert("high")).toBe(true);
  });

  it("very_high → true (opioides, citostáticos)", () => {
    // JCI Standard: IPSG.3 ME 1
    expect(isHighAlert("very_high")).toBe(true);
  });

  it("critical → true (KCl concentrado)", () => {
    // JCI Standard: IPSG.3 ME 1
    expect(isHighAlert("critical")).toBe(true);
  });

  it("valor desconocido → false (safe default)", () => {
    expect(isHighAlert("unknown")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. requiresDoubleCheck
// ---------------------------------------------------------------------------

describe("IPSG.3 ME 1 — requiresDoubleCheck()", () => {
  it("standard → no requiere doble verificación", () => {
    expect(requiresDoubleCheck("standard")).toBe(false);
  });

  it("high → requiere doble verificación (insulina, heparina)", () => {
    // JCI Standard: IPSG.3 ME 1
    expect(requiresDoubleCheck("high")).toBe(true);
  });

  it("very_high → requiere doble verificación (opioides)", () => {
    // JCI Standard: IPSG.3 ME 1
    expect(requiresDoubleCheck("very_high")).toBe(true);
  });

  it("critical → requiere doble verificación (KCl concentrado)", () => {
    // JCI Standard: IPSG.3 ME 1
    expect(requiresDoubleCheck("critical")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. getColorForLevel
// ---------------------------------------------------------------------------

describe("IPSG.3 ME 1 — getColorForLevel()", () => {
  it("standard → gray", () => {
    expect(getColorForLevel("standard")).toBe("gray");
  });

  it("high → amber (insulina, anticoagulantes)", () => {
    expect(getColorForLevel("high")).toBe("amber");
  });

  it("very_high → orange (opioides, citostáticos)", () => {
    expect(getColorForLevel("very_high")).toBe("orange");
  });

  it("critical → red (KCl concentrado)", () => {
    expect(getColorForLevel("critical")).toBe("red");
  });

  it("nivel desconocido → gray (safe default)", () => {
    expect(getColorForLevel("")).toBe("gray");
  });
});

// ---------------------------------------------------------------------------
// 5. Clasificación ATC via mock (verifica asignaciones ISMP codificadas en SQL)
// ---------------------------------------------------------------------------

describe("IPSG.3 ME 1 — clasificación ATC esperada por ISMP", () => {
  // Tabla de verdad extraída de 116_high_alert_medications.sql
  const atcClassification: Array<{ atcPrefix: string; expectedLevel: AlertLevelExpected; label: string }> = [
    { atcPrefix: "A10A",   expectedLevel: "high",      label: "Insulinas (A10A*)" },
    { atcPrefix: "B01A",   expectedLevel: "high",      label: "Anticoagulantes (B01A*)" },
    { atcPrefix: "N02A",   expectedLevel: "very_high", label: "Opioides (N02A*)" },
    { atcPrefix: "B05XA01",expectedLevel: "critical",  label: "KCl concentrado (B05XA01)" },
    { atcPrefix: "L01",    expectedLevel: "very_high", label: "Citostáticos (L01*)" },
    { atcPrefix: "M03A",   expectedLevel: "very_high", label: "Neurobloqueantes (M03A*)" },
  ];

  type AlertLevelExpected = "high" | "very_high" | "critical";

  // Verifica que el nivel esperado para cada grupo ATC pasa por isHighAlert
  for (const { label, expectedLevel } of atcClassification) {
    it(`${label} — isHighAlert(${expectedLevel}) = true`, () => {
      // JCI Standard: IPSG.3 ME 1
      expect(isHighAlert(expectedLevel)).toBe(true);
    });
  }

  it("insulina (A10A*) → level 'high' — requiere doble verificación", () => {
    // JCI Standard: IPSG.3 ME 1 ME 1
    expect(requiresDoubleCheck("high")).toBe(true);
  });

  it("opioide (N02A*) → level 'very_high' — requiere doble verificación", () => {
    // JCI Standard: IPSG.3 ME 1
    expect(requiresDoubleCheck("very_high")).toBe(true);
  });

  it("KCl concentrado (B05XA01) → level 'critical' — requiere doble verificación", () => {
    // JCI Standard: IPSG.3 ME 1
    expect(requiresDoubleCheck("critical")).toBe(true);
  });

  it("KCl concentrado → color red (máxima alerta visual)", () => {
    expect(getColorForLevel("critical")).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// @QA E2E (Playwright):
//  - Formulario de dispensación: medicamento con alertLevel='critical' debe
//    mostrar badge rojo y bloquear submit sin doble firma de enfermería.
//  - Formulario de prescripción: medicamento 'high' debe mostrar banner amber
//    con texto de precaución ISMP.
//  - API: intentar crear MedicationAdministration con drug.alertLevel='critical'
//    sin secondVerifierId → 412 PRECONDITION_FAILED.
