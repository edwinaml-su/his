/**
 * CC-0015 — Helpers puros para parsear el dump de listas de precios de Odoo
 * (docs/CC/0015/odoo-pricelists-dump.json) hacia filas de
 * "ServicePriceListItem". Extraído a módulo separado para poder testear sin
 * tocar BD (packages/database/scripts/__tests__/seed-tarifario-odoo.test.mjs).
 */

/**
 * Una regla del dump aplica a un producto concreto y con precio fijo cuando:
 *   - tipo === 'fixed' (excluye reglas 'formula' — ninguna útil aquí, siempre
 *     vienen ligadas a `aplica: '2_product_category'`, ver abajo).
 *   - aplica !== '2_product_category' (excluye reglas de categoría completa,
 *     que no referencian un producto — no hay `code` que asignarles).
 *
 * @param {{ tipo: string, aplica: string }} regla
 * @returns {boolean}
 */
export function esReglaAplicable(regla) {
  return regla.tipo === "fixed" && regla.aplica !== "2_product_category";
}

/**
 * Resuelve el `code` de "ServicePriceListItem" para una regla del dump.
 * Prioridad: `codigo` directo > prefijo `[COD]` embebido en `producto` >
 * sintético `ODOO-{producto_tmpl_id}` (productos archivados sin código).
 *
 * @param {{ codigo: string | null, producto: string | null, producto_tmpl_id: number | null }} regla
 * @returns {string}
 */
export function resolverCode(regla) {
  if (regla.codigo) return regla.codigo;
  const match = /^\[([^\]]+)\]\s*/.exec(regla.producto ?? "");
  if (match?.[1]) return match[1];
  return `ODOO-${regla.producto_tmpl_id}`;
}

/**
 * Limpia el nombre del producto para usarlo como `description`: quita el
 * prefijo `[COD]` (si existe) y trunca a `maxLen` (columna varchar(300)).
 *
 * @param {string | null} producto
 * @param {number} [maxLen]
 * @returns {string}
 */
export function limpiarDescripcion(producto, maxLen = 300) {
  const cleaned = (producto ?? "").replace(/^\[[^\]]+\]\s*/, "").trim();
  return cleaned.slice(0, maxLen);
}

/**
 * Convierte las reglas de una lista del dump en items deduplicados por
 * `code` (último gana — las reglas vienen en el mismo orden que el dump;
 * duplicados provienen de tiers por `min_qty` o de colisiones del código
 * sintético). Devuelve también el conteo de duplicados descartados.
 *
 * @param {Array<{codigo: string|null, producto: string|null, producto_tmpl_id: number|null, precio_fijo: number, tipo: string, aplica: string}>} reglas
 * @returns {{ items: Array<{code: string, description: string, unitPrice: number}>, duplicatesSkipped: number }}
 */
export function reglasAItems(reglas) {
  const porCode = new Map();
  let duplicatesSkipped = 0;

  for (const regla of reglas) {
    if (!esReglaAplicable(regla)) continue;
    const code = resolverCode(regla);
    if (porCode.has(code)) duplicatesSkipped++;
    porCode.set(code, {
      code,
      description: limpiarDescripcion(regla.producto),
      unitPrice: regla.precio_fijo,
    });
  }

  return { items: [...porCode.values()], duplicatesSkipped };
}
