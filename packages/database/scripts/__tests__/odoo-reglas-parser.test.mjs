/**
 * CC-0021 — Tests del reparto de reglas de Odoo entre ítem plano del tarifario
 * y "ServicePriceRule". Puro: no toca BD ni Odoo.
 *
 * Los casos usan las reglas REALES verificadas en odoo.complejoavante.com el
 * 2026-08-21 (ver docs/CC/0021), no ejemplos inventados.
 */
import { describe, it, expect } from "vitest";
import { esItemPlano, fechaOdoo, reglaAReglaHIS, particionarReglas } from "../lib/odoo-reglas-parser.mjs";

/** Regla real: precio fijo de un producto en la lista de farmacia. */
const FIJA = {
  id: 15736,
  aplica: "1_product",
  tipo: "fixed",
  base: "list_price",
  min_qty: 0,
  date_start: null,
  date_end: null,
  fixed_price: 14.25,
  percent_price: 0,
  price_discount: 0,
  price_surcharge: 0,
  price_round: 0,
  price_min_margin: 0,
  price_max_margin: 0,
  producto_tmpl_id: 40214,
  producto: "ABRILAR EA 575 JARABE 100ML",
  codigo: "ABR575",
  categoria_id: 175,
  categoria: "MEDICAMENTOS",
};

/** Regla real: markup del 6.38% sobre toda la categoría INSUMOS. */
const INSUMOS = {
  ...FIJA,
  id: 11796,
  aplica: "2_product_category",
  tipo: "formula",
  fixed_price: 0,
  price_discount: -6.38,
  min_qty: 1,
  producto_tmpl_id: null,
  producto: null,
  codigo: null,
  categoria_id: 172,
  categoria: "INSUMOS",
};

/** Regla real: margen fijo de 0.70 sobre la categoría IMAGENES, vigente desde jun-2026. */
const IMAGENES = {
  ...FIJA,
  id: 15027,
  aplica: "2_product_category",
  tipo: "formula",
  fixed_price: 0,
  price_min_margin: 0.7,
  price_max_margin: 0.7,
  date_start: "2026-06-29 15:00:00",
  producto_tmpl_id: null,
  producto: null,
  codigo: null,
  categoria_id: 171,
  categoria: "IMAGENES",
};

describe("esItemPlano", () => {
  it("acepta el precio fijo de un producto sin tramo ni vigencia", () => {
    expect(esItemPlano(FIJA)).toBe(true);
    expect(esItemPlano({ ...FIJA, aplica: "0_product_variant" })).toBe(true);
  });

  it("rechaza reglas de categoría y globales", () => {
    expect(esItemPlano(INSUMOS)).toBe(false);
    expect(esItemPlano({ ...FIJA, aplica: "3_global" })).toBe(false);
  });

  it("rechaza fórmulas y porcentajes", () => {
    expect(esItemPlano({ ...FIJA, tipo: "formula" })).toBe(false);
    expect(esItemPlano({ ...FIJA, tipo: "percentage" })).toBe(false);
  });

  it("rechaza tramos por cantidad — CC-0015 los perdía como duplicados", () => {
    expect(esItemPlano({ ...FIJA, min_qty: 10 })).toBe(false);
  });

  it("rechaza reglas con vigencia", () => {
    expect(esItemPlano({ ...FIJA, date_start: "2026-06-14 00:00:00" })).toBe(false);
    expect(esItemPlano({ ...FIJA, date_end: "2026-12-31 00:00:00" })).toBe(false);
  });
});

describe("fechaOdoo", () => {
  it("convierte el datetime de Odoo a ISO en UTC", () => {
    expect(fechaOdoo("2026-06-29 15:00:00")).toBe("2026-06-29T15:00:00Z");
  });

  it("trata false y null como sin fecha", () => {
    expect(fechaOdoo(false)).toBeNull();
    expect(fechaOdoo(null)).toBeNull();
  });
});

describe("reglaAReglaHIS", () => {
  it("mapea la regla de categoría INSUMOS conservando el descuento negativo (markup)", () => {
    const r = reglaAReglaHIS(INSUMOS);

    expect(r).toMatchObject({
      odooItemId: 11796,
      appliedOn: "category",
      itemCode: null,
      categoriaOdooId: 172,
      computePrice: "formula",
      base: "list_price",
      priceDiscount: -6.38,
      minQuantity: 1,
    });
  });

  it("mapea la regla de IMAGENES con sus márgenes y su vigencia", () => {
    const r = reglaAReglaHIS(IMAGENES);

    expect(r).toMatchObject({
      appliedOn: "category",
      categoriaOdooId: 171,
      priceMinMargin: 0.7,
      priceMaxMargin: 0.7,
      dateStart: "2026-06-29T15:00:00Z",
      dateEnd: null,
    });
  });

  it("colapsa variante y producto en el nivel `item` (el HIS no maneja variantes)", () => {
    expect(reglaAReglaHIS({ ...FIJA, aplica: "0_product_variant", min_qty: 5 })).toMatchObject({
      appliedOn: "item",
      itemCode: "ABR575",
      categoriaOdooId: null,
    });
  });

  it("traduce el base de Odoo al del HIS", () => {
    expect(reglaAReglaHIS({ ...FIJA, base: "standard_price", tipo: "formula" }).base).toBe("standard_cost");
    expect(reglaAReglaHIS({ ...FIJA, base: "pricelist", base_lista_id: 48, tipo: "formula" })).toMatchObject({
      base: "pricelist",
      baseListaOdooId: 48,
    });
  });

  it("no arrastra la lista base cuando el base no es una lista", () => {
    expect(reglaAReglaHIS({ ...FIJA, base: "list_price", base_lista_id: 48 }).baseListaOdooId).toBeNull();
  });
});

describe("particionarReglas", () => {
  it("separa ítems planos de reglas explícitas", () => {
    const { items, reglas } = particionarReglas([FIJA, INSUMOS, IMAGENES]);

    expect(items).toEqual([
      { code: "ABR575", description: "ABRILAR EA 575 JARABE 100ML", unitPrice: 14.25, categoriaOdooId: 175 },
    ]);
    expect(reglas.map((r) => r.odooItemId)).toEqual([11796, 15027]);
  });

  it("un tramo por cantidad ya no se pierde como duplicado", () => {
    const tramo = { ...FIJA, id: 99, min_qty: 10, fixed_price: 12.0 };
    const { items, reglas, duplicatesSkipped } = particionarReglas([FIJA, tramo]);

    expect(items).toHaveLength(1);
    expect(duplicatesSkipped).toBe(0);
    expect(reglas).toHaveLength(1);
    expect(reglas[0]).toMatchObject({ appliedOn: "item", itemCode: "ABR575", minQuantity: 10, fixedPrice: 12 });
  });

  it("dos reglas planas del mismo código conservan la última", () => {
    const { items, duplicatesSkipped } = particionarReglas([FIJA, { ...FIJA, id: 100, fixed_price: 9.99 }]);

    expect(duplicatesSkipped).toBe(1);
    expect(items[0].unitPrice).toBe(9.99);
  });
});
