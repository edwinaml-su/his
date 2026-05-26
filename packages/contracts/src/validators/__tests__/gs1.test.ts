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
  // ─── Casos oficiales GS1 (verificables en https://www.gs1.org/services/check-digit-calculator) ────
  //
  // El bug previo (PR #275, antes #224 / #210): el algoritmo tenía pesos
  // `(len - 1 - i) % 2 === 0 ? 3 : 1` (al revés respecto al estándar). Solo
  // pasaba para bodies donde la suma del peso invertido casualmente daba el
  // mismo check (ej. "0001234567890" → 5 con ambos). Para bodies con dígitos
  // no-cero en posiciones impares desde la izquierda, divergía y rechazaba
  // códigos GS1 perfectamente válidos.
  //
  // Los siguientes 6 fixtures distinguen el algoritmo correcto del invertido:
  //   - "00012345678905"     GTIN-14: ambos dan true (NO distingue)
  //   - "12345678901231"     GTIN-14: estándar=true, invertido=false (DISTINGUE)
  //   - "750300000000000421" GSRN-18: estándar=true, invertido=false (DISTINGUE)
  //   - "0017200000000004"   GTIN-14 (Sample GS1 v23, ApAdv): estándar=true
  //   - "9780201379624"      ISBN-13/GTIN-13 (famoso libro Cormen): estándar=true
  //   - "5012345678900"      GTIN-13 (calculadora GS1 oficial verifica)

  const VALID_GS1_OFFICIAL: Array<{ code: string; type: string }> = [
    { code: "00012345678905",     type: "GTIN-14 sample GS1 v23" },
    { code: "12345678901231",     type: "GTIN-14 (distingue bug)" },
    { code: "750300000000000421", type: "GSRN-18 (distingue bug)" },
    { code: "0017200000000004",   type: "GTIN-14 sample" },
    { code: "9780201379624",      type: "GTIN-13 (ISBN famoso)" },
    { code: "5012345678900",      type: "GTIN-13 calculadora GS1" },
  ];

  // Códigos que SOLO el algoritmo invertido aceptaría (false-positives del bug previo).
  // Si el fix está bien aplicado, estos deben ser rechazados.
  const REGRESSIONS_INVERTED: Array<{ code: string; reason: string }> = [
    { code: "12345678901235", reason: "check del algoritmo invertido — body 1234567890123 daría 5 al revés" },
  ];

  it.each(VALID_GS1_OFFICIAL)("acepta $type válido: $code", ({ code }) => {
    expect(gs1CheckDigitValid(code)).toBe(true);
  });

  it.each(REGRESSIONS_INVERTED)(
    "rechaza fixture del algoritmo invertido (regresión): $code",
    ({ code }) => {
      expect(gs1CheckDigitValid(code)).toBe(false);
    },
  );

  // ─── Casos negativos genéricos ────────────────────────────────────────────
  it.each([
    "00012345678900", // mismo body que sample GS1 oficial, check incorrecto
    "abc12345678905", // no-numérico
  ])("rechaza código inválido: %s", (code) => {
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

  // ─── Cross-check: paridad con gs1Mod10CheckDigit (algoritmo ya correcto) ──
  it("paridad con gs1Mod10CheckDigit para múltiples longitudes", async () => {
    const { gs1Mod10CheckDigit } = await import("../gs1");
    const bodies = [
      "0001234567890",      // GTIN-14 body (13)
      "1234567890123",      // GTIN-14 body (13)
      "75030000000000042",  // GSRN-18 body (17)
      "750300000000000",    // SSCC-18 body (17)
      "750123456789",       // GLN-13 body (12)
    ];
    for (const body of bodies) {
      const check = gs1Mod10CheckDigit(body);
      const full = body + String(check);
      expect(gs1CheckDigitValid(full)).toBe(true);
    }
  });
});
