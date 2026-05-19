/**
 * Tests fixture-based para validateGS1Checksum (US.F2.6.44)
 *
 * Cubre los 4 AIs requeridos:
 *  - AI 01  (GTIN-14) — Módulo-10 GS1
 *  - AI 8018 (GSRN-18) — Módulo-10 GS1
 *  - AI 00   (SSCC-18) — Módulo-10 GS1
 *  - AI 8003 (GRAI)   — Módulo-10 GS1 en los primeros 14 dígitos
 */

import { describe, it, expect } from "vitest";
import { validateGS1Checksum, validateGtinChecksum } from "../gs1";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// GTIN-14: cuerpo de 13 dígitos + check digit calculado con mod10 GS1
// Para "01234567890123": check = mod10("0123456789012") → calculado manualmente
// Usamos GTINs conocidos del estándar GS1:
const GTIN_VALID_FIXTURES = [
  "00012345678905", // GTIN-14 con padding, checksum correcto
  "01234567890128", // GTIN-14 clásico de ejemplo GS1
  "09780201634975", // GTIN-14 para ISBN 0-201-63-497-X (con padding)
];

const GTIN_INVALID_FIXTURES = [
  "00012345678906", // último dígito cambiado
  "01234567890129", // checksum incorrecto
  "1234567",        // muy corto
  "",               // vacío
  "ABCDEFGHIJKLMN", // no numérico
];

// GSRN-18: 17 dígitos + check digit
// Usamos buildGSRN para generar fixtures válidos e inválidos
// GSRN válidos de los tests de buildGSRN existentes:
const GSRN_VALID_FIXTURES = [
  "123456789000000009", // prefijo 9 dígitos + serial 8 + check
  // Construido: body="12345678900000000" → check = mod10("12345678900000000")
  // = calculado aquí para verificar fixture
];

// Para construir GSRN válido: body = "12345678900000000" (17 dígitos)
// sum: 1×3,2×1,3×3,4×1,5×3,6×1,7×3,8×1,9×3,0×1,0×3,0×1,0×3,0×1,0×3,0×1,0×3
// = 3+2+9+4+15+6+21+8+27+0+0+0+0+0+0+0+0 = 95 → mod10: 95%10=5 → 10-5=5 → check=5
// Pero la fixture hardcodeada arriba termina en 9 — generarla correctamente:
// body = "12345678900000000" → check = 5 → "123456789000000005"

const GSRN_VALID = "123456789000000005";
const GSRN_INVALID = "123456789000000009"; // check digit incorrecto

// SSCC-18 (AI 00): misma regla mod10, 18 dígitos
// body = "12345678901234567" (17 dígitos) → check = mod10(body)
// sum: 1×3+2×1+3×3+4×1+5×3+6×1+7×3+8×1+9×3+0×1+1×3+2×1+3×3+4×1+5×3+6×1+7×3
// = 3+2+9+4+15+6+21+8+27+0+3+2+9+4+15+6+21 = 155 → 155%10=5 → 10-5=5
const SSCC_VALID   = "123456789012345675"; // check = 5
const SSCC_INVALID = "123456789012345670"; // check incorrecto

// GRAI (AI 8003): los primeros 14 dígitos tienen checksum
// Usamos el mismo GTIN-14 válido como prefijo: "00012345678905" (14 dígitos)
// Seguido de referencia de activo: "ABC123" → GRAI completo = "00012345678905ABC123"
// validateGS1Checksum solo valida los primeros 14 dígitos numéricos
const GRAI_VALID   = "00012345678905";     // solo el segmento de 14 dígitos
const GRAI_INVALID = "00012345678906";     // check digit incorrecto

// ---------------------------------------------------------------------------
// Tests AI 01 — GTIN-14
// ---------------------------------------------------------------------------

describe("validateGS1Checksum — AI 01 (GTIN-14)", () => {
  it("acepta GTIN-14 con checksum correcto (fixture estándar)", () => {
    // "00012345678905": check digit = 5
    // body = "0001234567890" (13 dígitos)
    // sum: pos desde derecha: 0×3,9×1,8×3,7×1,6×3,5×1,4×3,3×1,2×3,1×1,0×3,0×1,0×3
    // = 0+9+24+7+18+5+12+3+6+1+0+0+0 = 85 → 85%10=5 → check=5 ✓
    expect(validateGS1Checksum("01", "00012345678905")).toBe(true);
  });

  it("rechaza GTIN-14 con checksum incorrecto", () => {
    expect(validateGS1Checksum("01", "00012345678906")).toBe(false);
  });

  it("rechaza GTIN-14 con longitud incorrecta (< 14)", () => {
    expect(validateGS1Checksum("01", "0001234")).toBe(false);
  });

  it("rechaza string vacío", () => {
    expect(validateGS1Checksum("01", "")).toBe(false);
  });

  it("rechaza AI desconocido", () => {
    expect(validateGS1Checksum("99", "00012345678905")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests AI 8018 — GSRN-18
// ---------------------------------------------------------------------------

describe("validateGS1Checksum — AI 8018 (GSRN-18)", () => {
  it("acepta GSRN-18 con checksum correcto", () => {
    // body = "12345678900000000" → check = 5
    expect(validateGS1Checksum("8018", GSRN_VALID)).toBe(true);
  });

  it("rechaza GSRN-18 con checksum incorrecto", () => {
    expect(validateGS1Checksum("8018", GSRN_INVALID)).toBe(false);
  });

  it("rechaza GSRN-18 con menos de 18 dígitos", () => {
    expect(validateGS1Checksum("8018", "12345678900000")).toBe(false);
  });

  it("rechaza GSRN-18 no numérico", () => {
    expect(validateGS1Checksum("8018", "ABCDEFGHIJKLMNOPQR")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests AI 00 — SSCC-18
// ---------------------------------------------------------------------------

describe("validateGS1Checksum — AI 00 (SSCC-18)", () => {
  it("acepta SSCC-18 con checksum correcto", () => {
    // body = "12345678901234567" → check = 5
    expect(validateGS1Checksum("00", SSCC_VALID)).toBe(true);
  });

  it("rechaza SSCC-18 con checksum incorrecto", () => {
    expect(validateGS1Checksum("00", SSCC_INVALID)).toBe(false);
  });

  it("rechaza SSCC-18 de longitud incorrecta", () => {
    expect(validateGS1Checksum("00", "123456789012345")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests AI 8003 — GRAI
// ---------------------------------------------------------------------------

describe("validateGS1Checksum — AI 8003 (GRAI)", () => {
  it("acepta GRAI con checksum correcto en primeros 14 dígitos", () => {
    // "00012345678905" → misma regla GTIN, check = 5
    expect(validateGS1Checksum("8003", GRAI_VALID)).toBe(true);
  });

  it("acepta GRAI con referencia de activo adicional si los primeros 14 son válidos", () => {
    // GRAI completo: prefijo 14 válido + referencia alfanumérica
    expect(validateGS1Checksum("8003", GRAI_VALID + "ABC123")).toBe(true);
  });

  it("rechaza GRAI con checksum incorrecto en los primeros 14 dígitos", () => {
    expect(validateGS1Checksum("8003", GRAI_INVALID)).toBe(false);
  });

  it("rechaza GRAI con menos de 14 dígitos", () => {
    expect(validateGS1Checksum("8003", "000123456789")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests de paridad con validateGtinChecksum existente
// ---------------------------------------------------------------------------

describe("validateGS1Checksum paridad con validateGtinChecksum", () => {
  it("AI 01 y validateGtinChecksum deben concordar para GTIN-14 válido", () => {
    expect(validateGS1Checksum("01", "00012345678905")).toBe(
      validateGtinChecksum("00012345678905"),
    );
  });

  it("AI 01 y validateGtinChecksum concuerdan para GTIN-14 inválido", () => {
    expect(validateGS1Checksum("01", "00012345678906")).toBe(
      validateGtinChecksum("00012345678906"),
    );
  });
});
