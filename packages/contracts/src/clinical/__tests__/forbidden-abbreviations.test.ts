/**
 * Tests unitarios — validateClinicalText + FORBIDDEN_ABBREVIATIONS.
 *
 * JCI Standard: IPSG.2 ME 3
 * "The organization develops and implements a list of abbreviations, acronyms,
 *  symbols, and dose designations that are not to be used throughout the
 *  organization."
 *
 * Estrategia: caja blanca sobre la función pura. Sin mocks. Sin I/O.
 * Cada entrada de FORBIDDEN_ABBREVIATIONS tiene al menos 1 test positivo
 * (detecta) y los casos válidos no generan falsos positivos.
 */
import { describe, it, expect } from "vitest";
import {
  validateClinicalText,
  FORBIDDEN_ABBREVIATIONS,
} from "../forbidden-abbreviations";

// ---------------------------------------------------------------------------
// Invariantes de la lista
// ---------------------------------------------------------------------------

describe("FORBIDDEN_ABBREVIATIONS lista", () => {
  it("tiene al menos 10 entradas (requisito US.JCI.5.6)", () => {
    expect(FORBIDDEN_ABBREVIATIONS.length).toBeGreaterThanOrEqual(10);
  });

  it("todas las entradas tienen severity 'error' o 'warning'", () => {
    for (const rule of FORBIDDEN_ABBREVIATIONS) {
      expect(["error", "warning"]).toContain(rule.severity);
    }
  });

  it("todas las entradas tienen replacement y rationale no vacíos", () => {
    for (const rule of FORBIDDEN_ABBREVIATIONS) {
      expect(rule.replacement.length).toBeGreaterThan(0);
      expect(rule.rationale.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// validateClinicalText — texto vacío / nulo
// ---------------------------------------------------------------------------

describe("validateClinicalText — texto vacío", () => {
  it("retorna listas vacías para string vacío", () => {
    const result = validateClinicalText("");
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("retorna listas vacías para solo espacios", () => {
    const result = validateClinicalText("   ");
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Casos JCI 'error' — deben detectarse
// ---------------------------------------------------------------------------

describe("validateClinicalText — errores JCI", () => {
  it("detecta U (unidad) — '10 U de insulina'", () => {
    const { errors } = validateClinicalText("Administrar 10 U de insulina Regular");
    expect(errors.some((e) => /U/.test(e.match))).toBe(true);
  });

  it("detecta IU — 'vitamina D 1000 IU'", () => {
    const { errors } = validateClinicalText("Vitamina D 1000 IU diario");
    expect(errors.some((e) => e.match.includes("IU"))).toBe(true);
  });

  it("detecta QD — 'omeprazol 20mg QD'", () => {
    const { errors } = validateClinicalText("omeprazol 20mg QD");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("detecta Q.D. con puntos", () => {
    const { errors } = validateClinicalText("metformina 500mg Q.D.");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("detecta QOD — 'metotrexato QOD'", () => {
    const { errors } = validateClinicalText("metotrexato QOD para artritis");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("detecta trailing zero — '1.0 mg'", () => {
    const { errors } = validateClinicalText("warfarina 1.0 mg diario");
    expect(errors.some((e) => e.match.includes("1.0"))).toBe(true);
  });

  it("detecta leading zero ausente — '.5 mg'", () => {
    const { errors } = validateClinicalText("digoxina .5 mg cada 24h");
    expect(errors.some((e) => e.match.includes(".5"))).toBe(true);
  });

  it("detecta MS — 'MS IV para dolor'", () => {
    const { errors } = validateClinicalText("Administrar MS IV para dolor agudo");
    expect(errors.some((e) => e.match === "MS")).toBe(true);
  });

  it("detecta MSO4", () => {
    const { errors } = validateClinicalText("MSO4 10mg SC");
    expect(errors.some((e) => e.match === "MSO4")).toBe(true);
  });

  it("detecta MgSO4", () => {
    const { errors } = validateClinicalText("MgSO4 2g IV para eclampsia");
    expect(errors.some((e) => e.match === "MgSO4")).toBe(true);
  });

  it("detecta μg", () => {
    const { errors } = validateClinicalText("fentanilo 25 μg transdérmico");
    expect(errors.some((e) => e.match === "μg")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Casos JCI 'warning' — deben detectarse como warnings, no errors
// ---------------------------------------------------------------------------

describe("validateClinicalText — warnings JCI", () => {
  it("detecta cc — '500 cc de suero'", () => {
    const { warnings } = validateClinicalText("Administrar 500 cc de suero fisiológico");
    expect(warnings.some((w) => w.match.includes("cc"))).toBe(true);
    // no debe ser error
    const { errors } = validateClinicalText("Administrar 500 cc de suero fisiológico");
    expect(errors.some((e) => e.match.includes("cc"))).toBe(false);
  });

  it("detecta hs — 'alprazolam 0.5 mg hs'", () => {
    const { warnings } = validateClinicalText("alprazolam 0.5 mg hs");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("detecta D/C — 'D/C antibiótico'", () => {
    const { warnings } = validateClinicalText("D/C antibiótico post-cirugía");
    expect(warnings.some((w) => w.match.includes("D"))).toBe(true);
  });

  it("detecta TIW", () => {
    const { warnings } = validateClinicalText("hemodiálisis TIW");
    expect(warnings.some((w) => w.match === "TIW")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Casos válidos — NO deben generar falsos positivos
// ---------------------------------------------------------------------------

describe("validateClinicalText — sin falsos positivos", () => {
  it("'QID' (cuatro veces/día) no se marca como QD", () => {
    // QID es válido — es diferente de QD
    const { errors } = validateClinicalText("amoxicilina 500mg QID por 7 días");
    // El patrón QD no debe dispararse dentro de "QID"
    const qdErrors = errors.filter((e) =>
      /^Q\.?D\.?$/.test(e.match),
    );
    expect(qdErrors).toHaveLength(0);
  });

  it("texto clínico limpio no genera hallazgos", () => {
    const clean =
      "Paciente masculino 45 años. Hipertensión arterial estadio II. " +
      "Plan: enalapril 10 mg diariamente, control tensional en 2 semanas. " +
      "Suspender AINEs por riesgo renal.";
    const { errors, warnings } = validateClinicalText(clean);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("'0.5 mg' con cero inicial no se detecta como leading zero ausente", () => {
    const { errors } = validateClinicalText("levotiroxina 0.5 mg diariamente");
    const leadingErrors = errors.filter((e) => e.replacement.includes("cero inicial"));
    expect(leadingErrors).toHaveLength(0);
  });

  it("número sin trailing zero '1 mg' no se detecta", () => {
    const { errors } = validateClinicalText("warfarina 1 mg diario");
    const trailingErrors = errors.filter((e) =>
      e.replacement.includes("decimal innecesario"),
    );
    expect(trailingErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Shape de AbbreviationWarning
// ---------------------------------------------------------------------------

describe("validateClinicalText — shape de salida", () => {
  it("cada finding tiene match, offset, replacement, rationale, severity", () => {
    const { errors } = validateClinicalText("IU de vitamina");
    expect(errors.length).toBeGreaterThan(0);
    const finding = errors[0]!;
    expect(typeof finding.match).toBe("string");
    expect(typeof finding.offset).toBe("number");
    expect(typeof finding.replacement).toBe("string");
    expect(typeof finding.rationale).toBe("string");
    expect(["error", "warning"]).toContain(finding.severity);
  });

  it("offset apunta al índice correcto en el texto", () => {
    const text = "Administrar 1000 IU vitamina D";
    const { errors } = validateClinicalText(text);
    const iuError = errors.find((e) => e.match.includes("IU"));
    expect(iuError).toBeDefined();
    expect(text.substring(iuError!.offset, iuError!.offset + iuError!.match.length)).toBe(
      iuError!.match,
    );
  });
});
