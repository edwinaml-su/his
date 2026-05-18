/**
 * Tests de validación cliente del campo gs1CompanyPrefix (US.F2.S7.W2).
 * Verifica la misma regex que usa OrganizationGs1PrefixDialog y
 * el schema Zod del router: /^\d{7,9}$/.
 */
import { describe, it, expect } from "vitest";

const GS1_PREFIX_REGEX = /^\d{7,9}$/;

/**
 * Replica la lógica de validatePrefix del dialog.
 * Vacío = null (org sin prefijo configurado), valid = null, inválido = mensaje.
 */
function validatePrefix(value: string): string | null {
  if (value === "") return null;
  if (!GS1_PREFIX_REGEX.test(value)) {
    return "El prefijo GS1 debe tener entre 7 y 9 dígitos numéricos.";
  }
  return null;
}

describe("gs1CompanyPrefix client validation", () => {
  describe("valores válidos (deben retornar null)", () => {
    it("acepta prefijo de 7 dígitos", () => {
      expect(validatePrefix("7503000")).toBeNull();
    });

    it("acepta prefijo de 8 dígitos", () => {
      expect(validatePrefix("75030001")).toBeNull();
    });

    it("acepta prefijo de 9 dígitos", () => {
      expect(validatePrefix("750300012")).toBeNull();
    });

    it("acepta string vacío (equivale a null — sin prefijo configurado)", () => {
      expect(validatePrefix("")).toBeNull();
    });
  });

  describe("valores inválidos (deben retornar mensaje de error)", () => {
    it("rechaza prefijo de 6 dígitos (demasiado corto)", () => {
      expect(validatePrefix("123456")).not.toBeNull();
    });

    it("rechaza prefijo de 10 dígitos (demasiado largo)", () => {
      expect(validatePrefix("1234567890")).not.toBeNull();
    });

    it("rechaza prefijo con letras", () => {
      expect(validatePrefix("750300A")).not.toBeNull();
    });

    it("rechaza prefijo con guiones", () => {
      expect(validatePrefix("750-3000")).not.toBeNull();
    });

    it("rechaza prefijo con espacios", () => {
      expect(validatePrefix("750 3000")).not.toBeNull();
    });
  });
});
