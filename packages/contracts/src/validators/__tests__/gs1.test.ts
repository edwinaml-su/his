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
import { buildGSRN, validateGSRN } from "../gs1";

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
