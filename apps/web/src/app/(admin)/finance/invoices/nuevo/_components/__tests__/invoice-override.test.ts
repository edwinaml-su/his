// @vitest-environment jsdom
/**
 * docs/48 Ola 4b (H-17) — tests de la lógica pura del override de precio.
 * Extraída de `nueva-factura-shell.tsx` justamente para poder testearla sin
 * depender de interacción con `<Select>` de Radix (no simulable en jsdom en
 * este repo — ver `nueva-factura-shell.test.tsx`).
 */
import { describe, it, expect } from "vitest";
import {
  attachOverrideJustificacion,
  esErrorDePrecio,
  puedeOverridePrecio,
  ROLES_OVERRIDE_PRECIO,
} from "../invoice-override";

describe("esErrorDePrecio", () => {
  it("reconoce el mensaje de precio no resoluble", () => {
    expect(
      esErrorDePrecio('No se pudo resolver el precio del código "LAB-01". Cargue la tarifa o use overridePrecio con rol ADMIN/DIR.'),
    ).toBe(true);
  });

  it("reconoce el mensaje de precio que no coincide con el resuelto", () => {
    expect(
      esErrorDePrecio('El precio enviado (10) no coincide con el resuelto por el servidor (12) para "LAB-01". Use overridePrecio para forzarlo.'),
    ).toBe(true);
  });

  it("no reconoce otros PRECONDITION_FAILED ajenos a precio", () => {
    expect(esErrorDePrecio("La cuenta indicada no pertenece a este paciente o tenant.")).toBe(false);
  });

  it("undefined/vacío no rompe y devuelve false", () => {
    expect(esErrorDePrecio(undefined)).toBe(false);
    expect(esErrorDePrecio("")).toBe(false);
  });
});

describe("puedeOverridePrecio", () => {
  it("true si el usuario tiene rol ADMIN", () => {
    expect(puedeOverridePrecio(["ADMIN", "PHYSICIAN"])).toBe(true);
  });

  it("true si el usuario tiene rol DIR", () => {
    expect(puedeOverridePrecio(["DIR"])).toBe(true);
  });

  it("false sin ADMIN ni DIR", () => {
    expect(puedeOverridePrecio(["ACCOUNTANT", "BILLING"])).toBe(false);
  });

  it("false con lista vacía", () => {
    expect(puedeOverridePrecio([])).toBe(false);
  });

  it("ROLES_OVERRIDE_PRECIO es el mismo trío de invoice.router.ts", () => {
    expect(ROLES_OVERRIDE_PRECIO).toEqual(["ADMIN", "DIR"]);
  });
});

describe("attachOverrideJustificacion", () => {
  const items = [
    { code: "LAB-01", unitPrice: 10 },
    { code: "LAB-02", unitPrice: 20 },
  ];

  it("sin justificacion, devuelve los items sin overridePrecio", () => {
    const result = attachOverrideJustificacion(items);
    expect(result).toEqual(items);
    expect(result.every((it) => !("overridePrecio" in it))).toBe(true);
  });

  it("con justificacion, la adjunta a TODAS las líneas (el server ignora la de las que sí coinciden)", () => {
    const result = attachOverrideJustificacion(items, "Tarifa pactada, autorizada por Dirección");
    expect(result).toHaveLength(2);
    for (const it of result) {
      expect(it).toMatchObject({
        overridePrecio: { justificacion: "Tarifa pactada, autorizada por Dirección" },
      });
    }
    // No muta el array/objetos originales.
    expect(items[0]).not.toHaveProperty("overridePrecio");
  });
});
