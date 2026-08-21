/**
 * CC-0021 — Helpers puros para convertir las reglas de `product.pricelist.item`
 * de Odoo en las dos formas que usa el HIS:
 *
 *   · "ServicePriceListItem" — el ítem plano del tarifario (code → precio).
 *     Es la forma del 99.9% de las reglas reales de Odoo y la que ya importó
 *     CC-0015; el motor la evalúa como la regla implícita
 *     `item / fixed / minQuantity 0 / sin vigencia`.
 *
 *   · "ServicePriceRule" — todo lo que el ítem plano NO sabe expresar:
 *     reglas de categoría o globales, precio calculado (percentage/formula),
 *     base distinto del catálogo, tramos por cantidad y vigencia por regla.
 *
 * Sin efectos secundarios ni imports de @his/database, para poder testear sin
 * tocar BD — mismo patrón que odoo-tarifario-parser.mjs (CC-0015).
 */

import { resolverCode, limpiarDescripcion } from "./odoo-tarifario-parser.mjs";

/** applied_on de Odoo → "appliedOn" del HIS (el HIS no maneja variantes). */
const APLICA_A_APPLIED_ON = {
  "0_product_variant": "item",
  "1_product": "item",
  "2_product_category": "category",
  "3_global": "global",
};

/** base de Odoo → "base" del HIS. */
const BASE_ODOO_A_HIS = {
  list_price: "list_price",
  standard_price: "standard_cost",
  pricelist: "pricelist",
};

/**
 * Una regla de Odoo cabe en el ítem plano del tarifario cuando es un precio
 * fijo sobre un producto concreto, sin tramo de cantidad ni vigencia — es
 * decir, cuando no pierde nada al representarse como (code, unitPrice).
 *
 * @param {{ tipo: string, aplica: string, min_qty?: number, date_start?: string|null, date_end?: string|null }} regla
 * @returns {boolean}
 */
export function esItemPlano(regla) {
  return (
    regla.tipo === "fixed" &&
    regla.aplica !== "2_product_category" &&
    regla.aplica !== "3_global" &&
    !(Number(regla.min_qty) > 0) &&
    !regla.date_start &&
    !regla.date_end
  );
}

/** Normaliza una fecha de Odoo ('2026-06-29 15:00:00' o false) a ISO o null. */
export function fechaOdoo(valor) {
  if (!valor) return null;
  return `${String(valor).replace(" ", "T")}Z`;
}

/**
 * Convierte una regla de Odoo en una fila de "ServicePriceRule".
 * `price_markup` se ignora a propósito: en Odoo es el espejo de
 * `price_discount` (la regla real de INSUMOS trae -6.38 y +6.38), y contarlo
 * dos veces duplicaría el margen.
 *
 * @param {object} regla
 * @returns {object} fila lista para el INSERT (sin priceListId, que se resuelve por nombre de lista).
 */
export function reglaAReglaHIS(regla) {
  const appliedOn = APLICA_A_APPLIED_ON[regla.aplica] ?? "item";

  return {
    odooItemId: regla.id,
    appliedOn,
    itemCode: appliedOn === "item" ? resolverCode(regla) : null,
    categoriaOdooId: appliedOn === "category" ? (regla.categoria_id ?? null) : null,
    minQuantity: Number(regla.min_qty) || 0,
    dateStart: fechaOdoo(regla.date_start),
    dateEnd: fechaOdoo(regla.date_end),
    computePrice: regla.tipo,
    fixedPrice: regla.tipo === "fixed" ? Number(regla.fixed_price) : null,
    percentPrice: Number(regla.percent_price) || 0,
    base: BASE_ODOO_A_HIS[regla.base] ?? "list_price",
    baseListaOdooId: regla.base === "pricelist" ? (regla.base_lista_id ?? null) : null,
    priceDiscount: Number(regla.price_discount) || 0,
    priceSurcharge: Number(regla.price_surcharge) || 0,
    priceRound: Number(regla.price_round) || 0,
    priceMinMargin: Number(regla.price_min_margin) || 0,
    priceMaxMargin: Number(regla.price_max_margin) || 0,
    notes: descripcionRegla(regla, appliedOn),
  };
}

/** Texto corto que deja rastro de qué regla de Odoo originó la fila. */
function descripcionRegla(regla, appliedOn) {
  const objetivo =
    appliedOn === "category"
      ? `categoría ${regla.categoria ?? regla.categoria_id}`
      : appliedOn === "global"
        ? "toda la lista"
        : (regla.producto ?? resolverCode(regla));
  return `Odoo item ${regla.id} · ${regla.tipo} · ${objetivo}`.slice(0, 300);
}

/**
 * Parte las reglas de una lista en ítems planos deduplicados y reglas
 * explícitas. Los duplicados de (lista, code) conservan el último, igual que
 * CC-0015 — pero ahora los tramos por cantidad ya NO son duplicados: salen
 * como reglas y por eso dejan de perderse.
 *
 * @param {Array<object>} reglas
 * @returns {{ items: Array<{code:string, description:string, unitPrice:number, categoriaOdooId: number|null}>,
 *             reglas: Array<object>, duplicatesSkipped: number }}
 */
export function particionarReglas(reglas) {
  const porCode = new Map();
  const explicitas = [];
  let duplicatesSkipped = 0;

  for (const regla of reglas) {
    if (esItemPlano(regla)) {
      const code = resolverCode(regla);
      if (porCode.has(code)) duplicatesSkipped++;
      porCode.set(code, {
        code,
        description: limpiarDescripcion(regla.producto),
        unitPrice: Number(regla.fixed_price),
        categoriaOdooId: regla.categoria_id ?? null,
      });
      continue;
    }
    explicitas.push(reglaAReglaHIS(regla));
  }

  return { items: [...porCode.values()], reglas: explicitas, duplicatesSkipped };
}
