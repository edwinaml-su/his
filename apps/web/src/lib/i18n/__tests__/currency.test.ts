/**
 * CC-A (auditoría 2026-09-18, P1) — tests de `formatCurrency`.
 */
import { describe, it, expect } from "vitest";
import { formatCurrency } from "../currency";

describe("formatCurrency", () => {
  it("formatea USD en es-SV con el símbolo $ (default)", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
  });

  it("acepta otra moneda (GTQ)", () => {
    // Node ICU inserta un espacio no separable (U+00A0) entre el código y el
    // monto para monedas sin símbolo dedicado — se normaliza antes de comparar.
    expect(formatCurrency(100, "GTQ").replace(/ /g, " ")).toBe("GTQ 100.00");
  });

  it("acepta otro locale", () => {
    expect(formatCurrency(1234.56, "USD", "en-US")).toBe("$1,234.56");
  });

  it("negativos se formatean con signo", () => {
    expect(formatCurrency(-5)).toBe("-$5.00");
  });

  it("null/undefined/NaN -> '—' (nunca lanza)", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined)).toBe("—");
    expect(formatCurrency(Number.NaN)).toBe("—");
  });
});
