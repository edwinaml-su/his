/**
 * Tests — validateGSRN / buildGSRN (módulo-10 GS1).
 *
 * Casos:
 *   1. buildGSRN genera 18 dígitos con dígito verificador correcto
 *   2. validateGSRN acepta GSRN bien formado
 *   3. validateGSRN rechaza GSRN con dígito verificador incorrecto
 *   4. validateGSRN rechaza longitud distinta de 18
 *   5. validateGSRN rechaza null/undefined
 *   6. buildGSRN lanza si prefijo fuera de rango
 *   7. buildGSRN lanza si serial negativo
 *   8. Idempotencia: buildGSRN + validateGSRN = true para distintos seriales
 */
import { describe, it, expect } from "vitest";
import { buildGSRN, gs1CheckDigitValid, validateGSRN } from "../gs1";

describe("buildGSRN", () => {
  it("genera GSRN de exactamente 18 dígitos", () => {
    const gsrn = buildGSRN("7503000", 1);
    expect(gsrn).toHaveLength(18);
  });

  it("el GSRN generado pasa validateGSRN", () => {
    const gsrn = buildGSRN("7503000", 42);
    expect(validateGSRN(gsrn)).toBe(true);
  });

  it("idempotencia: distintos seriales dan GSRNs distintos y todos válidos", () => {
    const serials = [0, 1, 100, 9999, 999999];
    const gsrns = serials.map((s) => buildGSRN("7503000", s));
    const unique = new Set(gsrns);
    expect(unique.size).toBe(serials.length); // todos distintos
    gsrns.forEach((g) => expect(validateGSRN(g)).toBe(true));
  });

  it("funciona con prefijos de 7, 8 y 9 dígitos", () => {
    expect(validateGSRN(buildGSRN("1234567", 10))).toBe(true);
    expect(validateGSRN(buildGSRN("12345678", 10))).toBe(true);
    expect(validateGSRN(buildGSRN("123456789", 10))).toBe(true);
  });

  it("lanza si prefijo tiene menos de 7 dígitos", () => {
    expect(() => buildGSRN("750300", 1)).toThrow();
  });

  it("lanza si prefijo tiene más de 9 dígitos", () => {
    expect(() => buildGSRN("7503000123", 1)).toThrow();
  });

  it("lanza si serial es negativo", () => {
    expect(() => buildGSRN("7503000", -1)).toThrow();
  });

  it("lanza si prefijo contiene letras", () => {
    expect(() => buildGSRN("750300X", 1)).toThrow();
  });
});

describe("validateGSRN", () => {
  it("rechaza null", () => {
    expect(validateGSRN(null)).toBe(false);
  });

  it("rechaza undefined", () => {
    expect(validateGSRN(undefined)).toBe(false);
  });

  it("rechaza string vacío", () => {
    expect(validateGSRN("")).toBe(false);
  });

  it("rechaza GSRN con longitud distinta de 18", () => {
    expect(validateGSRN("75030000000000000")).toBe(false);  // 17
    expect(validateGSRN("7503000000000000042")).toBe(false); // 19
  });

  it("rechaza GSRN con dígito verificador incorrecto", () => {
    const good = buildGSRN("7503000", 1);
    const bad = good.slice(0, 17) + String((Number(good.charAt(17)) + 1) % 10);
    expect(validateGSRN(bad)).toBe(false);
  });

  it("acepta GSRN con guiones (los ignora)", () => {
    const good = buildGSRN("7503000", 5);
    const withDashes = good.slice(0, 9) + "-" + good.slice(9);
    expect(validateGSRN(withDashes)).toBe(true);
  });
});

// =============================================================================
// gs1CheckDigitValid — Módulo-10 GS1 genérico (HI-08)
// =============================================================================

describe("gs1CheckDigitValid", () => {
  /**
   * Helper local — calcula el check digit con el MISMO algoritmo que
   * `gs1CheckDigitValid`. Permite construir fixtures derivadas sin
   * recurrir a `buildGSRN` (que usa otra variante interna).
   */
  function deriveCheckDigit(body: string): string {
    const len = body.length + 1;
    let sum = 0;
    for (let i = 0; i < body.length; i++) {
      const weight = (len - 1 - i) % 2 === 0 ? 3 : 1;
      sum += Number.parseInt(body.charAt(i), 10) * weight;
    }
    return String((10 - (sum % 10)) % 10);
  }

  function makeValid(body: string): string {
    return body + deriveCheckDigit(body);
  }

  // Sample real GS1 v23 (GTIN-14 oficial — externamente verificable)
  const REAL_GTIN_14_SAMPLE = "00012345678905";

  // 5 GTINs derivados (incluye sample real + 4 generadas con el algoritmo)
  const VALID_GTIN_14 = [
    REAL_GTIN_14_SAMPLE,
    makeValid("0750123456789"), // El Salvador-style
    makeValid("0001234567890"),
    makeValid("9501234567890"),
    makeValid("2000000000000"), // borde: muchos ceros
  ];

  // GLN-13 (1 longitud distinta)
  const VALID_GLN_13 = makeValid("750123456789");

  // SSCC-18 (1 longitud distinta)
  const VALID_SSCC_18 = makeValid("75030000000000000");

  // 3 inválidos: digit incorrecto / dos GTINs con typo / no-numérico
  const INVALID_CODES = [
    REAL_GTIN_14_SAMPLE.slice(0, -1) + "0", // mismo body, check incorrecto
    makeValid("9999999999999").slice(0, -1) + "8", // check off by 1
    "abc12345678905", // no-numérico
  ];

  it.each(VALID_GTIN_14)("acepta GTIN-14 válido: %s", (gtin) => {
    expect(gtin).toHaveLength(14);
    expect(gs1CheckDigitValid(gtin)).toBe(true);
  });

  it("acepta GLN-13 derivado con el mismo algoritmo", () => {
    expect(VALID_GLN_13).toHaveLength(13);
    expect(gs1CheckDigitValid(VALID_GLN_13)).toBe(true);
  });

  it("acepta SSCC-18 derivado con el mismo algoritmo", () => {
    expect(VALID_SSCC_18).toHaveLength(18);
    expect(gs1CheckDigitValid(VALID_SSCC_18)).toBe(true);
  });

  it.each(INVALID_CODES)("rechaza código inválido: %s", (code) => {
    expect(gs1CheckDigitValid(code)).toBe(false);
  });

  it("rechaza string vacío y de longitud < 2", () => {
    expect(gs1CheckDigitValid("")).toBe(false);
    expect(gs1CheckDigitValid("5")).toBe(false);
  });

  it("rechaza no-string / null / undefined", () => {
    expect(gs1CheckDigitValid(12345 as unknown as string)).toBe(false);
    expect(gs1CheckDigitValid(null as unknown as string)).toBe(false);
    expect(gs1CheckDigitValid(undefined as unknown as string)).toBe(false);
  });
});
