import { describe, it, expect } from "vitest";
import { parseGs1String, validateGtinChecksum } from "../parse-ai";

// ---------------------------------------------------------------------------
// validateGtinChecksum
// ---------------------------------------------------------------------------
describe("validateGtinChecksum", () => {
  it("acepta GTIN-14 válido", () => {
    // 00012345678905 — check digit = 5
    expect(validateGtinChecksum("00012345678905")).toBe(true);
  });

  it("rechaza GTIN-14 con checksum incorrecto", () => {
    expect(validateGtinChecksum("00012345678900")).toBe(false);
  });

  it("acepta GTIN-13 (EAN-13) válido paddeado internamente", () => {
    // 5901234123457 (EAN-13 ejemplo canónico)
    expect(validateGtinChecksum("5901234123457")).toBe(true);
  });

  it("rechaza string no numérico", () => {
    expect(validateGtinChecksum("0001234567890X")).toBe(false);
  });

  it("rechaza longitud inválida (15 dígitos)", () => {
    expect(validateGtinChecksum("000123456789055")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseGs1String — casos felices
// ---------------------------------------------------------------------------
describe("parseGs1String — happy path", () => {
  it("parsea GTIN solo", () => {
    const result = parseGs1String("0100012345678905");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.gtin).toBe("00012345678905");
  });

  it("parsea GTIN + lot + expiry + serial con FNC1", () => {
    // Construido manualmente: AI01 (fijo) + AI10 (var) + FNC1 + AI17 (fijo) + AI21 (var)
    const raw = "0100012345678905" + "10LOT001\x1D" + "17260101" + "21SN0042";
    const result = parseGs1String(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.gtin).toBe("00012345678905");
      expect(result.data.lot).toBe("LOT001");
      expect(result.data.expiry).toBe("260101");
      expect(result.data.serial).toBe("SN0042");
    }
  });

  it("ignora header ]d2 de @zxing", () => {
    const result = parseGs1String("]d20100012345678905");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.gtin).toBe("00012345678905");
  });

  it("ignora header ]C1", () => {
    const result = parseGs1String("]C10100012345678905");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.gtin).toBe("00012345678905");
  });

  it("parsea solo lot + serial sin GTIN", () => {
    const raw = "10LOTE42\x1D21SERIE01";
    const result = parseGs1String(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.gtin).toBeUndefined();
      expect(result.data.lot).toBe("LOTE42");
      expect(result.data.serial).toBe("SERIE01");
    }
  });

  it("parsea expiry YYMMDD correctamente", () => {
    const raw = "1726123100012345678905";
    // AI17 fijo=6 → "261231" expiry
    const result = parseGs1String("0100012345678905" + "17261231");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.expiry).toBe("261231");
  });
});

// ---------------------------------------------------------------------------
// parseGs1String — errores
// ---------------------------------------------------------------------------
describe("parseGs1String — errores", () => {
  it("devuelve EMPTY_INPUT para string vacío", () => {
    const result = parseGs1String("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EMPTY_INPUT");
  });

  it("devuelve EMPTY_INPUT para string solo espacios", () => {
    const result = parseGs1String("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EMPTY_INPUT");
  });

  it("devuelve INVALID_GTIN_CHECKSUM para GTIN con checksum malo", () => {
    // AI01 + GTIN con último dígito alterado
    const raw = "0100012345678900"; // check digit 0 en lugar de 5
    const result = parseGs1String(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_GTIN_CHECKSUM");
  });

  it("resultado ok=false preserva mensaje descriptivo", () => {
    const result = parseGs1String("0100012345678900");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("checksum");
  });
});

// ---------------------------------------------------------------------------
// Casos edge
// ---------------------------------------------------------------------------
describe("parseGs1String — edge cases", () => {
  it("FNC1 al inicio del string no rompe el parser", () => {
    const raw = "\x1D0100012345678905";
    const result = parseGs1String(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.gtin).toBe("00012345678905");
  });

  it("AIs desconocidos son ignorados sin error", () => {
    // AI 91 (company internal) antes del GTIN
    const raw = "91INTERNAL\x1D0100012345678905";
    const result = parseGs1String(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.gtin).toBe("00012345678905");
  });

  it("GTIN-12 (UPC-A) es aceptado y paddeado a 14", () => {
    // 012345678905 → pad → 00012345678905 (mismo checksum)
    expect(validateGtinChecksum("012345678905")).toBe(true);
  });
});
