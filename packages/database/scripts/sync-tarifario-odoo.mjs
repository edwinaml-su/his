#!/usr/bin/env node
/**
 * CC-0021 — Sincronización del tarifario de Odoo con el motor de reglas del HIS.
 *
 * Sucesor de seed-tarifario-odoo.mjs (CC-0015), que solo sabía importar precios
 * fijos por producto y descartaba el resto. Este script trae TODAS las reglas de
 * `product.pricelist.item` y las reparte en las dos formas del HIS (sql/204):
 *   · precio fijo por producto, sin tramo ni vigencia → "ServicePriceListItem"
 *   · todo lo demás (categoría, global, fórmula, porcentaje, base distinto,
 *     tramos por cantidad, vigencia por regla) → "ServicePriceRule"
 *
 * Dos modos, ninguno escribe en la BD:
 *
 *   # 1) Extracción read-only desde Odoo (requiere ODOO_* en el entorno).
 *   node --env-file=apps/web/.env.local packages/database/scripts/sync-tarifario-odoo.mjs \
 *        --extract docs/CC/0021/odoo-pricelists-dump.json
 *
 *   # 2) Emisión de SQL idempotente para aplicar vía Supabase MCP / SQL Editor.
 *   node packages/database/scripts/sync-tarifario-odoo.mjs \
 *        --emit-sql docs/CC/0021/sql --dump docs/CC/0021/odoo-pricelists-dump.json
 *
 * El SQL emitido se aplica en orden alfabético de archivo y es reejecutable.
 * Requiere sql/204 aplicado y las listas "ODOO — {nombre}" ya creadas por
 * CC-0015 (000_listas.sql de aquel seed).
 *
 * Política del proyecto: la integración con Odoo es SOLO LECTURA.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { particionarReglas } from "./lib/odoo-reglas-parser.mjs";
import { odooListName, sqlEscape, slugify } from "./lib/odoo-tarifario-sql.mjs";

const args = process.argv.slice(2);
const flag = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : null;
};

const EXTRACT_PATH = flag("--extract");
const EMIT_SQL_DIR = flag("--emit-sql");
const DUMP_PATH = flag("--dump") ?? "docs/CC/0021/odoo-pricelists-dump.json";

/** Filas VALUES por archivo, para que el MCP no reciba sentencias gigantes. */
const ITEMS_POR_CHUNK = 120;

// =============================================================================
// Modo 1 — extracción desde Odoo
// =============================================================================

async function extraer(destino) {
  const { connect } = await import("./lib/odoo-xmlrpc.mjs");
  const { exec, url } = await connect();

  const listas = await exec("product.pricelist", "search_read", [[["active", "=", true]]], {
    fields: ["id", "name", "active", "currency_id", "company_id", "sequence"],
    order: "id asc",
  });

  // product.pricelist.item no tiene `active` en Odoo 18 — no filtrar por él.
  const itemsOdoo = await exec("product.pricelist.item", "search_read", [[]], {
    fields: [
      "id", "pricelist_id", "applied_on", "categ_id", "product_tmpl_id", "product_id",
      "min_quantity", "base", "base_pricelist_id", "compute_price", "fixed_price",
      "percent_price", "price_discount", "price_surcharge", "price_round",
      "price_min_margin", "price_max_margin", "date_start", "date_end",
    ],
    order: "pricelist_id, id",
  });

  // Código y categoría del producto de cada regla (una sola lectura por lote).
  const tmplIds = [...new Set(itemsOdoo.map((i) => i.product_tmpl_id && i.product_tmpl_id[0]).filter(Boolean))];
  const plantillas = new Map();
  for (let i = 0; i < tmplIds.length; i += 500) {
    const lote = await exec("product.template", "read", [tmplIds.slice(i, i + 500), ["id", "default_code", "categ_id"]]);
    for (const p of lote) plantillas.set(p.id, p);
  }

  const categorias = await exec("product.category", "search_read", [[]], {
    fields: ["id", "name", "parent_id"],
    order: "id asc",
  });

  const reglas = itemsOdoo.map((i) => {
    const tmpl = i.product_tmpl_id ? plantillas.get(i.product_tmpl_id[0]) : null;
    const categoriaProducto = tmpl?.categ_id || null;
    const categoriaRegla = i.categ_id || null;
    return {
      id: i.id,
      lista_id: i.pricelist_id[0],
      lista: i.pricelist_id[1],
      aplica: i.applied_on,
      tipo: i.compute_price,
      base: i.base,
      base_lista_id: i.base_pricelist_id ? i.base_pricelist_id[0] : null,
      min_qty: i.min_quantity,
      date_start: i.date_start || null,
      date_end: i.date_end || null,
      fixed_price: i.fixed_price,
      percent_price: i.percent_price,
      price_discount: i.price_discount,
      price_surcharge: i.price_surcharge,
      price_round: i.price_round,
      price_min_margin: i.price_min_margin,
      price_max_margin: i.price_max_margin,
      producto_tmpl_id: i.product_tmpl_id ? i.product_tmpl_id[0] : null,
      producto: (i.product_id && i.product_id[1]) || (i.product_tmpl_id && i.product_tmpl_id[1]) || null,
      codigo: tmpl?.default_code || null,
      // Categoría de la REGLA (solo en reglas de categoría) o, para un ítem,
      // la del producto — que es la que clasifica al ítem del tarifario.
      categoria_id: categoriaRegla ? categoriaRegla[0] : categoriaProducto ? categoriaProducto[0] : null,
      categoria: categoriaRegla ? categoriaRegla[1] : categoriaProducto ? categoriaProducto[1] : null,
    };
  });

  const dump = {
    extraido: new Date().toISOString(),
    fuente: url,
    odoo_version: "18.0",
    listas: listas.map((l) => ({
      id: l.id,
      name: l.name,
      active: l.active,
      currency: l.currency_id ? l.currency_id[1] : null,
      company: l.company_id ? l.company_id[1] : null,
      sequence: l.sequence,
    })),
    categorias: categorias.map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id ? c.parent_id[0] : null })),
    total_reglas: reglas.length,
    reglas,
  };

  writeFileSync(destino, JSON.stringify(dump, null, 1));
  console.log(`✓ ${dump.listas.length} listas · ${reglas.length} reglas · ${categorias.length} categorías → ${destino}`);
}

// =============================================================================
// Modo 2 — emisión de SQL
// =============================================================================

/** Literal SQL de un valor JS (string/number/null). */
function lit(valor) {
  if (valor === null || valor === undefined) return "NULL";
  if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : "NULL";
  return `'${sqlEscape(valor)}'`;
}

const CABECERA = (archivo, descripcion) => `-- =============================================================================
-- ${archivo} (emitido por sync-tarifario-odoo.mjs --emit-sql)
-- CC-0021 — ${descripcion}
-- Requiere sql/204_cc0021_motor_reglas_precios.sql aplicado y las listas
-- "ODOO — {nombre}" ya creadas (CC-0015, 000_listas.sql).
-- Idempotente: reejecutable sin duplicar filas.
-- =============================================================================
`;

/**
 * 000_categorias.sql — una "ServiceCategory" por categoría de Odoo referenciada,
 * para cada org real. El árbol se enlaza en una segunda pasada, cuando todas
 * las filas ya existen.
 */
function buildCategoriasSql(categorias) {
  const values = categorias
    .map((c) => `    (${c.id}, ${lit(codigoCategoria(c.name))}, ${lit(c.name.slice(0, 120))}, ${c.parent_id ?? "NULL"})`)
    .join(",\n");

  return `${CABECERA("000_categorias.sql", `${categorias.length} categorías de servicio × org real.`)}
INSERT INTO "ServiceCategory" ("organizationId", code, nombre, "odooCategId")
SELECT o.id, v.code, v.nombre, v.odoo_id
FROM "Organization" o
CROSS JOIN (VALUES
${values}
) AS v(odoo_id, code, nombre, parent_odoo_id)
WHERE o."legalName" NOT LIKE 'RLS-Test%'
  AND NOT EXISTS (
    SELECT 1 FROM "ServiceCategory" sc
     WHERE sc."organizationId" = o.id AND sc.code = v.code
  );

-- Segunda pasada: enlaza el árbol (padre dentro de la misma org).
UPDATE "ServiceCategory" hija
   SET "parentId" = padre.id, "updatedAt" = now()
  FROM (VALUES
${values}
  ) AS v(odoo_id, code, nombre, parent_odoo_id)
  JOIN "ServiceCategory" padre ON padre."odooCategId" = v.parent_odoo_id
 WHERE hija."odooCategId" = v.odoo_id
   AND hija."organizationId" = padre."organizationId"
   AND v.parent_odoo_id IS NOT NULL
   AND hija."parentId" IS DISTINCT FROM padre.id;
`;
}

/** Código estable y legible de la categoría (unique por org junto al nombre). */
function codigoCategoria(nombre) {
  return slugify(nombre).toUpperCase().replace(/-/g, "_").slice(0, 40) || "SIN_CATEGORIA";
}

/**
 * NNN_items_*.sql — upsert de los ítems planos, ahora con su categoría.
 * El JOIN por nombre de lista multiplica por cada org real, igual que CC-0015.
 */
function buildItemsSql(itemsPorLista) {
  const planos = [];
  for (const { listaName, items } of itemsPorLista) {
    for (const item of items) planos.push({ listaName, ...item });
  }

  const archivos = [];
  for (let i = 0; i < planos.length; i += ITEMS_POR_CHUNK) {
    const chunk = planos.slice(i, i + ITEMS_POR_CHUNK);
    const seq = String(archivos.length + 1).padStart(3, "0");
    const filename = `${seq}_items_${slugify(chunk[0].listaName.replace(/^ODOO — /, ""))}.sql`;

    const values = chunk
      .map(
        (it) =>
          `    (${lit(it.listaName)}, ${lit(it.code)}, ${lit(it.description)}, ${Number(it.unitPrice).toFixed(2)}, ${it.categoriaOdooId ?? "NULL"})`,
      )
      .join(",\n");

    archivos.push({
      filename,
      sql: `${CABECERA(filename, `Chunk ${archivos.length + 1} — ${chunk.length} ítems × org real.`)}
INSERT INTO "ServicePriceListItem" ("priceListId", code, description, "unitPrice", "categoryId", active, "updatedAt")
SELECT pl.id, v.code, v.description, v.unit_price::numeric(14,2), sc.id, true, now()
FROM (VALUES
${values}
) AS v(lista_name, code, description, unit_price, categ_odoo_id)
JOIN "ServicePriceList" pl ON pl.name = v.lista_name
LEFT JOIN "ServiceCategory" sc
  ON sc."organizationId" = pl."organizationId" AND sc."odooCategId" = v.categ_odoo_id::int
ON CONFLICT ("priceListId", code) WHERE code IS NOT NULL DO UPDATE SET
  description = EXCLUDED.description,
  "unitPrice" = EXCLUDED."unitPrice",
  "categoryId" = COALESCE(EXCLUDED."categoryId", "ServicePriceListItem"."categoryId"),
  active = true,
  "updatedAt" = now();
`,
    });
  }

  return archivos;
}

/** 900_reglas.sql — upsert de "ServicePriceRule" por (lista, odooItemId). */
function buildReglasSql(reglasPorLista, nombreListaPorId) {
  const filas = [];
  for (const { listaName, reglas } of reglasPorLista) {
    for (const r of reglas) {
      filas.push({
        listaName,
        baseListaName: r.baseListaOdooId ? (nombreListaPorId.get(r.baseListaOdooId) ?? null) : null,
        ...r,
      });
    }
  }

  const values = filas
    .map(
      (r) =>
        `    (${lit(r.listaName)}, ${lit(r.appliedOn)}, ${lit(r.itemCode)}, ${r.categoriaOdooId ?? "NULL"}, ` +
        `${r.minQuantity}, ${lit(r.dateStart)}, ${lit(r.dateEnd)}, ${lit(r.computePrice)}, ` +
        `${r.fixedPrice === null ? "NULL" : Number(r.fixedPrice).toFixed(2)}, ${r.percentPrice}, ` +
        `${lit(r.base)}, ${lit(r.baseListaName)}, ${r.priceDiscount}, ${r.priceSurcharge}, ` +
        `${r.priceRound}, ${r.priceMinMargin}, ${r.priceMaxMargin}, ${lit(r.notes)}, ${r.odooItemId})`,
    )
    .join(",\n");

  return `${CABECERA("900_reglas.sql", `${filas.length} reglas explícitas × org real (categoría, global, fórmula, tramos y vigencia).`)}
-- Las reglas de categoría cuya categoría no exista en la org se omiten en vez
-- de violar el CHECK spr_target_chk (ver el WHERE del final).

INSERT INTO "ServicePriceRule"
  ("priceListId", "appliedOn", "itemCode", "categoryId", "minQuantity", "dateStart", "dateEnd",
   "computePrice", "fixedPrice", "percentPrice", base, "basePriceListId",
   "priceDiscount", "priceSurcharge", "priceRound", "priceMinMargin", "priceMaxMargin",
   notes, "odooItemId")
SELECT pl.id, v.applied_on, v.item_code, sc.id, v.min_quantity::numeric,
       v.date_start::timestamptz, v.date_end::timestamptz,
       v.compute_price, v.fixed_price::numeric, v.percent_price::numeric,
       v.base, bl.id,
       v.price_discount::numeric, v.price_surcharge::numeric, v.price_round::numeric,
       v.price_min_margin::numeric, v.price_max_margin::numeric,
       v.notes, v.odoo_item_id::int
FROM (VALUES
${values}
) AS v(lista_name, applied_on, item_code, categ_odoo_id, min_quantity, date_start, date_end,
       compute_price, fixed_price, percent_price, base, base_lista_name,
       price_discount, price_surcharge, price_round, price_min_margin, price_max_margin,
       notes, odoo_item_id)
JOIN "ServicePriceList" pl ON pl.name = v.lista_name
LEFT JOIN "ServiceCategory" sc
  ON sc."organizationId" = pl."organizationId" AND sc."odooCategId" = v.categ_odoo_id::int
LEFT JOIN "ServicePriceList" bl
  ON bl."organizationId" = pl."organizationId" AND bl.name = v.base_lista_name
WHERE (v.applied_on <> 'category' OR sc.id IS NOT NULL)
  AND (v.base <> 'pricelist' OR bl.id IS NOT NULL)
ON CONFLICT ("priceListId", "odooItemId") WHERE "odooItemId" IS NOT NULL DO UPDATE SET
  "appliedOn"      = EXCLUDED."appliedOn",
  "itemCode"       = EXCLUDED."itemCode",
  "categoryId"     = EXCLUDED."categoryId",
  "minQuantity"    = EXCLUDED."minQuantity",
  "dateStart"      = EXCLUDED."dateStart",
  "dateEnd"        = EXCLUDED."dateEnd",
  "computePrice"   = EXCLUDED."computePrice",
  "fixedPrice"     = EXCLUDED."fixedPrice",
  "percentPrice"   = EXCLUDED."percentPrice",
  base             = EXCLUDED.base,
  "basePriceListId"= EXCLUDED."basePriceListId",
  "priceDiscount"  = EXCLUDED."priceDiscount",
  "priceSurcharge" = EXCLUDED."priceSurcharge",
  "priceRound"     = EXCLUDED."priceRound",
  "priceMinMargin" = EXCLUDED."priceMinMargin",
  "priceMaxMargin" = EXCLUDED."priceMaxMargin",
  notes            = EXCLUDED.notes,
  active           = true,
  "updatedAt"      = now();
`;
}

function emitirSql(dump, dir) {
  mkdirSync(dir, { recursive: true });

  const reglasPorLista = new Map();
  for (const r of dump.reglas) {
    if (!reglasPorLista.has(r.lista_id)) reglasPorLista.set(r.lista_id, []);
    reglasPorLista.get(r.lista_id).push(r);
  }

  const nombreListaPorId = new Map(dump.listas.map((l) => [l.id, odooListName(l.name)]));

  const itemsPorLista = [];
  const explicitasPorLista = [];
  let totalItems = 0;
  let totalReglas = 0;
  let totalDuplicados = 0;

  for (const lista of dump.listas) {
    const crudas = reglasPorLista.get(lista.id) ?? [];
    if (crudas.length === 0) continue;
    const { items, reglas, duplicatesSkipped } = particionarReglas(crudas);
    const listaName = odooListName(lista.name);
    if (items.length) itemsPorLista.push({ listaName, items });
    if (reglas.length) explicitasPorLista.push({ listaName, reglas });
    totalItems += items.length;
    totalReglas += reglas.length;
    totalDuplicados += duplicatesSkipped;
  }

  // Solo las categorías realmente referenciadas (por un ítem o por una regla).
  const usadas = new Set();
  for (const { items } of itemsPorLista) for (const i of items) if (i.categoriaOdooId) usadas.add(i.categoriaOdooId);
  for (const { reglas } of explicitasPorLista) for (const r of reglas) if (r.categoriaOdooId) usadas.add(r.categoriaOdooId);
  // …y sus ancestros, para que el árbol quede completo.
  const porId = new Map(dump.categorias.map((c) => [c.id, c]));
  for (const id of [...usadas]) {
    let actual = porId.get(id)?.parent_id;
    while (actual && !usadas.has(actual)) {
      usadas.add(actual);
      actual = porId.get(actual)?.parent_id;
    }
  }
  const categorias = dump.categorias.filter((c) => usadas.has(c.id));

  const archivos = [
    { filename: "000_categorias.sql", sql: buildCategoriasSql(categorias) },
    ...buildItemsSql(itemsPorLista).map((a) => ({ ...a, filename: `1${a.filename}` })),
    { filename: "900_reglas.sql", sql: buildReglasSql(explicitasPorLista, nombreListaPorId) },
  ];

  for (const { filename, sql } of archivos) writeFileSync(`${dir}/${filename}`, sql);

  console.log(`✓ ${archivos.length} archivos SQL en ${dir}`);
  console.log(`  categorías: ${categorias.length}`);
  console.log(`  ítems planos: ${totalItems} (duplicados descartados: ${totalDuplicados})`);
  console.log(`  reglas explícitas: ${totalReglas}`);
}

// =============================================================================

if (EXTRACT_PATH) {
  await extraer(EXTRACT_PATH);
} else if (EMIT_SQL_DIR) {
  emitirSql(JSON.parse(readFileSync(DUMP_PATH, "utf8")), EMIT_SQL_DIR);
} else {
  console.error("Uso: --extract <archivo.json> | --emit-sql <dir> [--dump <archivo.json>]");
  process.exit(1);
}
