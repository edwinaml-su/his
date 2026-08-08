/**
 * CC-0015 — Tests unitarios del parser puro del dump de tarifario Odoo.
 * No toca BD ni el dump real; usa fixtures mínimas inline.
 */
import { describe, it, expect } from "vitest";
import {
  esReglaAplicable,
  resolverCode,
  limpiarDescripcion,
  reglasAItems,
} from "../lib/odoo-tarifario-parser.mjs";

describe("esReglaAplicable", () => {
  it("acepta reglas fixed que aplican a producto", () => {
    expect(esReglaAplicable({ tipo: "fixed", aplica: "1_product" })).toBe(true);
    expect(esReglaAplicable({ tipo: "fixed", aplica: "0_product_variant" })).toBe(true);
  });

  it("rechaza reglas formula", () => {
    expect(esReglaAplicable({ tipo: "formula", aplica: "1_product" })).toBe(false);
  });

  it("rechaza reglas de categoría completa", () => {
    expect(esReglaAplicable({ tipo: "fixed", aplica: "2_product_category" })).toBe(false);
  });
});

describe("resolverCode", () => {
  it("usa el campo codigo cuando existe", () => {
    expect(resolverCode({ codigo: "5.14", producto: "[5.14] AEROMAX", producto_tmpl_id: 40238 })).toBe(
      "5.14",
    );
  });

  it("extrae el código del prefijo [COD] en producto cuando codigo es null", () => {
    expect(
      resolverCode({ codigo: null, producto: "[1.58] Adorlan x Comprimido", producto_tmpl_id: 40237 }),
    ).toBe("1.58");
  });

  it("genera código sintético ODOO-{tmplId} cuando no hay codigo ni prefijo", () => {
    expect(
      resolverCode({ codigo: null, producto: "ABRILAR EA 575 JARABE 100ML", producto_tmpl_id: 40214 }),
    ).toBe("ODOO-40214");
  });
});

describe("limpiarDescripcion", () => {
  it("quita el prefijo [COD] del nombre del producto", () => {
    expect(limpiarDescripcion("[5.14] AEROMAX LIBRE DE CFC 100MCG")).toBe(
      "AEROMAX LIBRE DE CFC 100MCG",
    );
  });

  it("deja intacto un producto sin prefijo", () => {
    expect(limpiarDescripcion("ABRILAR EA 575 JARABE 100ML")).toBe("ABRILAR EA 575 JARABE 100ML");
  });

  it("trunca a maxLen", () => {
    expect(limpiarDescripcion("X".repeat(400), 300)).toHaveLength(300);
  });

  it("maneja producto null", () => {
    expect(limpiarDescripcion(null)).toBe("");
  });
});

describe("reglasAItems", () => {
  it("omite reglas formula/categoría y convierte el resto a items", () => {
    const reglas = [
      { tipo: "fixed", aplica: "1_product", codigo: "A1", producto: "[A1] Item A", producto_tmpl_id: 1, precio_fijo: 10.5 },
      { tipo: "formula", aplica: "2_product_category", codigo: null, producto: null, producto_tmpl_id: null, precio_fijo: 0 },
      { tipo: "fixed", aplica: "1_product", codigo: null, producto: "Item B", producto_tmpl_id: 2, precio_fijo: 3.25 },
    ];
    const { items, duplicatesSkipped } = reglasAItems(reglas);

    expect(items).toEqual([
      { code: "A1", description: "Item A", unitPrice: 10.5 },
      { code: "ODOO-2", description: "Item B", unitPrice: 3.25 },
    ]);
    expect(duplicatesSkipped).toBe(0);
  });

  it("conserva la última regla cuando dos reglas resuelven al mismo code (tiers min_qty)", () => {
    const reglas = [
      { tipo: "fixed", aplica: "1_product", codigo: "A1", producto: "[A1] Item A", producto_tmpl_id: 1, precio_fijo: 10 },
      { tipo: "fixed", aplica: "1_product", codigo: "A1", producto: "[A1] Item A", producto_tmpl_id: 1, precio_fijo: 8 },
    ];
    const { items, duplicatesSkipped } = reglasAItems(reglas);

    expect(items).toEqual([{ code: "A1", description: "Item A", unitPrice: 8 }]);
    expect(duplicatesSkipped).toBe(1);
  });
});
