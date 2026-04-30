/**
 * Tests de validators DUI/NIT/NIE (TDR §27.3).
 * Cobertura objetivo: 100% de líneas y branches.
 *
 * Estrategia paridad SQL ↔ TS:
 *   La matriz `IDENTIFIER_PARITY_MATRIX` es la fuente de verdad de
 *   fixtures. Si `validate_dui`/`validate_nit` SQL cambian, esta matriz
 *   debe actualizarse y los tests fallarán hasta lograr coincidencia.
 */
import { describe, it, expect } from "vitest";
import {
  IDENTIFIER_PARITY_MATRIX,
  VALID_DUIS,
  VALID_DUIS_WITH_DASH,
  VALID_NITS,
  VALID_NIES,
  INVALID_DUIS,
  INVALID_NITS,
  INVALID_NIES,
  computeDuiCheckDigit,
  computeNitCheckDigit,
  makeValidDUI,
  makeValidNIT,
} from "@his/test-utils/fixtures/dui";
import {
  validateDUI,
  validateNIT,
  validateNIE,
  validateIdentifier,
} from "../index";

describe("validateDUI — algoritmo módulo 10", () => {
  it.each(VALID_DUIS)("acepta DUI válido: %s", (dui) => {
    expect(validateDUI(dui)).toBe(true);
  });

  it.each(VALID_DUIS_WITH_DASH)("acepta DUI válido con guion: %s", (dui) => {
    expect(validateDUI(dui)).toBe(true);
  });

  it("rechaza null y undefined", () => {
    expect(validateDUI(null)).toBe(false);
    expect(validateDUI(undefined)).toBe(false);
  });

  it("rechaza string vacío", () => {
    expect(validateDUI(INVALID_DUIS.empty)).toBe(false);
  });

  it("rechaza solo espacios", () => {
    expect(validateDUI(INVALID_DUIS.whitespace)).toBe(false);
  });

  it("rechaza longitud incorrecta", () => {
    expect(validateDUI(INVALID_DUIS.tooShort)).toBe(false);
    expect(validateDUI(INVALID_DUIS.tooLong)).toBe(false);
  });

  it("rechaza dígito verificador incorrecto", () => {
    expect(validateDUI(INVALID_DUIS.badCheck)).toBe(false);
  });

  it("acepta DUI con caracteres no numéricos que al normalizar quedan 9 dígitos", () => {
    // El validador strip de no-dígitos: 'abc12345678X9def' donde X es el check.
    const valid = VALID_DUIS[9]!; // 12345678 + check
    const dirty = `abc${valid.slice(0, 8)}-${valid.slice(8)}def`;
    expect(validateDUI(dirty)).toBe(true);
  });

  it("computeDuiCheckDigit produce un dígito 0..9", () => {
    for (let i = 0; i < 100; i++) {
      const body = String(i).padStart(8, "0");
      const c = computeDuiCheckDigit(body);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(9);
    }
  });

  it("makeValidDUI siempre genera un DUI que valida true", () => {
    for (let i = 0; i < 50; i++) {
      const body = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
      expect(validateDUI(makeValidDUI(body))).toBe(true);
    }
  });
});

describe("validateNIT — algoritmo módulo 11", () => {
  it.each(VALID_NITS)("acepta NIT válido: %s", (nit) => {
    expect(validateNIT(nit)).toBe(true);
  });

  it("rechaza null/undefined/empty", () => {
    expect(validateNIT(null)).toBe(false);
    expect(validateNIT(undefined)).toBe(false);
    expect(validateNIT(INVALID_NITS.empty)).toBe(false);
  });

  it("rechaza longitud incorrecta", () => {
    expect(validateNIT(INVALID_NITS.tooShort)).toBe(false);
    expect(validateNIT(INVALID_NITS.tooLong)).toBe(false);
  });

  it("rechaza dígito verificador incorrecto", () => {
    expect(validateNIT(INVALID_NITS.badCheck)).toBe(false);
  });

  it("makeValidNIT siempre produce NIT válido", () => {
    for (let i = 0; i < 50; i++) {
      const body = String(Math.floor(Math.random() * 1e13)).padStart(13, "0");
      expect(validateNIT(makeValidNIT(body))).toBe(true);
    }
  });

  it("computeNitCheckDigit ∈ [0..9]", () => {
    for (let i = 0; i < 30; i++) {
      const body = String(i * 7919).padStart(13, "0").slice(-13);
      const c = computeNitCheckDigit(body);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(9);
    }
  });
});

describe("validateNIE — estructura alfanumérica + delegación a NIT", () => {
  it.each(VALID_NIES)("acepta NIE válido: %s", (nie) => {
    expect(validateNIE(nie)).toBe(true);
  });

  it("rechaza null/undefined/empty", () => {
    expect(validateNIE(null)).toBe(false);
    expect(validateNIE(undefined)).toBe(false);
    expect(validateNIE(INVALID_NIES.empty)).toBe(false);
  });

  it("rechaza longitud fuera de [9..14]", () => {
    expect(validateNIE(INVALID_NIES.tooShort)).toBe(false);
    expect(validateNIE(INVALID_NIES.tooLong)).toBe(false);
  });

  it("rechaza 14 dígitos puros con verificador NIT inválido", () => {
    expect(validateNIE(INVALID_NIES.badNumeric)).toBe(false);
  });

  it("acepta letras+números mixtos", () => {
    expect(validateNIE("ABC123XYZ")).toBe(true);
  });
});

describe("validateIdentifier — dispatcher por kind", () => {
  it("DUI delega a validateDUI", () => {
    expect(validateIdentifier("DUI", VALID_DUIS[0]!)).toBe(true);
    expect(validateIdentifier("DUI", INVALID_DUIS.badCheck)).toBe(false);
  });
  it("NIT delega a validateNIT", () => {
    expect(validateIdentifier("NIT", VALID_NITS[0]!)).toBe(true);
    expect(validateIdentifier("NIT", INVALID_NITS.badCheck)).toBe(false);
  });
  it("NIE delega a validateNIE", () => {
    expect(validateIdentifier("NIE", VALID_NIES[0]!)).toBe(true);
    expect(validateIdentifier("NIE", INVALID_NIES.empty)).toBe(false);
  });
  it("PASSPORT y otros se aceptan estructuralmente si no están vacíos", () => {
    expect(validateIdentifier("PASSPORT", "AB1234567")).toBe(true);
    expect(validateIdentifier("PASSPORT", "")).toBe(false);
    expect(validateIdentifier("MINOR_ID", "  ")).toBe(false);
    expect(validateIdentifier("OTHER", "X")).toBe(true);
  });
});

/**
 * SQL parity matrix — debe mantenerse sincronizada con
 * `packages/database/prisma/migrations/sql/03_validations_sv.sql`.
 * Si esta matriz se desincroniza, este test es la primera línea de defensa.
 */
describe("Paridad SQL ↔ TS (matriz canónica)", () => {
  it.each(IDENTIFIER_PARITY_MATRIX)(
    "[$category] $kind '$value' → $expected",
    ({ kind, value, expected }) => {
      expect(validateIdentifier(kind, value)).toBe(expected);
    },
  );
});
