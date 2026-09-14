/**
 * Tests — validateGIAI / buildGIAI / parseGs1String AI 8004 (CC-0029).
 *
 * GIAI (AI 8004) NO lleva dígito verificador GS1 (a diferencia de
 * GTIN/SSCC/GSRN/GRAI) — la validación es puramente estructural: prefijo GS1
 * numérico (7-12 dígitos) + referencia de activo alfanumérica, ≤30
 * caracteres totales.
 */
import { describe, it, expect } from "vitest";
import { validateGIAI, buildGIAI, parseGs1String } from "../gs1";

describe("validateGIAI", () => {
  it("acepta prefijo 7 dígitos + referencia alfanumérica corta", () => {
    expect(validateGIAI("7410398AT001")).toBe(true);
  });

  it("acepta prefijo de 12 dígitos + referencia de 1 carácter", () => {
    expect(validateGIAI("1234567890129")).toBe(true); // 12 dígitos + "9"
  });

  it("acepta longitud total exactamente 30", () => {
    const value = "7410398" + "A".repeat(23); // 7 + 23 = 30
    expect(value).toHaveLength(30);
    expect(validateGIAI(value)).toBe(true);
  });

  it("rechaza longitud total > 30", () => {
    const value = "7410398" + "A".repeat(24); // 31 caracteres
    expect(validateGIAI(value)).toBe(false);
  });

  it("rechaza prefijo con menos de 7 dígitos", () => {
    expect(validateGIAI("741039AT001")).toBe(false); // prefijo de 6
  });

  it("rechaza cuando falta la referencia de activo (solo prefijo)", () => {
    expect(validateGIAI("7410398")).toBe(false);
  });

  it("rechaza prefijo no numérico", () => {
    expect(validateGIAI("74A0398AT001")).toBe(false);
  });

  it("rechaza caracteres fuera de alfanumérico en la referencia", () => {
    expect(validateGIAI("7410398AT-001")).toBe(false);
  });

  it("rechaza null/undefined/vacío", () => {
    expect(validateGIAI(null)).toBe(false);
    expect(validateGIAI(undefined)).toBe(false);
    expect(validateGIAI("")).toBe(false);
  });

  it("acepta con espacios al inicio/fin (se recortan)", () => {
    expect(validateGIAI("  7410398AT001  ")).toBe(true);
  });
});

describe("buildGIAI", () => {
  it("genera GIAI válido con prefijo + assetTag simple", () => {
    const giai = buildGIAI("7410398", "AT-001");
    expect(giai).toBe("7410398AT001"); // guion saneado
    expect(validateGIAI(giai)).toBe(true);
  });

  it("es determinista: mismo assetTag → mismo GIAI", () => {
    const a = buildGIAI("7410398", "VENT-042");
    const b = buildGIAI("7410398", "VENT-042");
    expect(a).toBe(b);
  });

  it("assetTags distintos generan GIAI distintos", () => {
    const a = buildGIAI("7410398", "AT-001");
    const b = buildGIAI("7410398", "AT-002");
    expect(a).not.toBe(b);
  });

  it("sanea minúsculas y símbolos preservando alfanuméricos", () => {
    const giai = buildGIAI("7410398", "vent_042/uci");
    expect(giai).toBe("7410398vent042uci");
  });

  it("trunca la referencia cuando el assetTag saneado excede el espacio disponible", () => {
    const longTag = "A".repeat(40);
    const giai = buildGIAI("7410398", longTag);
    expect(giai).toHaveLength(30); // 7 (prefijo) + 23 (máximo de referencia)
    expect(validateGIAI(giai)).toBe(true);
  });

  it("funciona con prefijo de 12 dígitos (espacio de referencia mínimo)", () => {
    const giai = buildGIAI("123456789012", "AT-001-LARGO");
    expect(giai.startsWith("123456789012")).toBe(true);
    expect(validateGIAI(giai)).toBe(true);
  });

  it("lanza si companyPrefix no es numérico de 7-12 dígitos", () => {
    expect(() => buildGIAI("123", "AT-001")).toThrow();
    expect(() => buildGIAI("ABCDEFG", "AT-001")).toThrow();
    expect(() => buildGIAI("1234567890123", "AT-001")).toThrow(); // 13 dígitos
  });

  it("lanza si la referencia queda vacía tras el saneo", () => {
    expect(() => buildGIAI("7410398", "---///")).toThrow();
  });
});

describe("parseGs1String — AI 8004 (GIAI)", () => {
  it("extrae el GIAI cuando es el único AI presente", () => {
    const result = parseGs1String("80047410398AT001");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.giai).toBe("7410398AT001");
  });

  it("extrae GIAI seguido de otro AI (01) cuando vienen separados por FNC1", () => {
    // AI 8004 es de longitud variable — igual que AI 10/21, necesita FNC1
    // (\x1D) para saber dónde termina si no es el último elemento del string.
    const FNC1 = "\x1D";
    const result = parseGs1String(`80047410398AT001${FNC1}0100012345678905`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.giai).toBe("7410398AT001");
      expect(result.data.gtin).toBe("00012345678905");
    }
  });

  it("string vacío da EMPTY_INPUT", () => {
    const result = parseGs1String("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EMPTY_INPUT");
  });
});
