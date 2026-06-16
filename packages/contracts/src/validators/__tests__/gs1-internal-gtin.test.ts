/**
 * Tests de GTIN-14 interno + GS1 DataMatrix para unidosis (guía GS1 El Salvador §6.2).
 */
import { describe, it, expect } from "vitest";
import { buildInternalGtin, buildGs1DataMatrix, validateGtinChecksum } from "../gs1";

describe("buildInternalGtin", () => {
  it("genera un GTIN-14 con dígito verificador Módulo-10 válido", () => {
    const gtin = buildInternalGtin("0741123", 4567);
    expect(gtin).toHaveLength(14);
    expect(validateGtinChecksum(gtin)).toBe(true);
  });

  it("es determinístico para el mismo prefijo + serial", () => {
    expect(buildInternalGtin("0741123", 1)).toBe(buildInternalGtin("0741123", 1));
  });

  it("rechaza prefijo no numérico", () => {
    expect(() => buildInternalGtin("ABC123", 1)).toThrow();
  });

  it("rechaza serial que excede el espacio disponible", () => {
    // prefijo de 12 → refLength = 1 → serial 99 (2 dígitos) no cabe.
    expect(() => buildInternalGtin("074112345678", 99)).toThrow();
  });
});

describe("buildGs1DataMatrix", () => {
  it("arma (01)(17)(10) con el lote (variable) al final", () => {
    const s = buildGs1DataMatrix("07411234567890", "L-89452X", "281031");
    expect(s).toBe("(01)07411234567890(17)281031(10)L-89452X");
  });

  it("omite (17) cuando no hay vencimiento", () => {
    expect(buildGs1DataMatrix("07411234567890", "L1")).toBe("(01)07411234567890(10)L1");
  });
});
