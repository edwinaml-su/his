/**
 * CC-0015 — Helpers puros para emitir SQL estático idempotente del tarifario
 * Odoo (modo `--emit-sql` de seed-tarifario-odoo.mjs). Separado en módulo
 * importable (sin efectos secundarios ni imports de @his/database) para
 * poder testear sin tocar BD — mismo patrón que odoo-tarifario-parser.mjs.
 *
 * Usado cuando DATABASE_URL local no tiene credenciales válidas (password
 * real es Sensitive en Vercel): en vez de escribir por Prisma, genera
 * archivos .sql para aplicar vía Supabase MCP (execute_sql / apply_migration).
 */

/** code TipoCuenta (sql/191) → nombre exacto de la lista en el dump de Odoo. */
export const TIPO_CUENTA_A_LISTA = {
  PARTICULAR: "Precios Avante Complejo Hospitalario",
  ISBM: "PRECIOS ISBM",
  MAPFRE: "PRECIOS MAPFRE SEGUROS EL SALVADOR SA",
  ABANK: "PRECIOS ASEGURADORA ABANK SA",
  ASESUISA: "PRECIOS ASESUISA VIDA SA",
  SISA_VIDA: "PRECIOS SISA VIDA SA SEGURO DE PERSONAS",
  CIGNA: "PRECIOS CIGNA HEALTHCARE",
  PALIC: "PRECIOS PAN AMERICAN LIFE",
  DAVIVIENDA: "PRECIOS DAVIVIENDA",
  CEL: "PRECIOS COMISION EJECUTIVA HIDROELECTRICA DE RIO LEMPA",
  MEDIPROCESOS: "PRECIOS MEDIPROCESOS SA DE CV",
  AGRICOLA: "PRECIOS ASEGURADORA AGRICOLA COMERCIAL SA DE CV",
  ASSA: "PRECIOS ASSA COMPANIA DE SEGUROS DE VIDA",
  ENLACES: "PRECIOS ENLACES EL SALVADOR SA DE CV",
  DRSV: "TARIFARIO DRSV 2026",
  DRSV_IMG: "DrSV - IMAGENES",
};

/**
 * Cuántas organizaciones reales existen hoy en prod (verificado por el
 * orquestador vía MCP: 3). Los archivos emitidos son correctos para
 * CUALQUIER cantidad de orgs reales (la multiplicación ocurre en SQL vía
 * JOIN por nombre de lista al momento de aplicar) — esta constante SOLO se
 * usa para (a) dimensionar el tamaño de chunk de items de modo que las
 * filas resultantes no superen ~400, y (b) reportar un estimado de filas
 * en la consola. Si el conteo real de orgs cambia, el chunk size deja de
 * ser óptimo pero el SQL sigue siendo correcto.
 */
export const ASSUMED_ORG_COUNT = 3;
export const MAX_ROWS_PER_CHUNK = 400;
export const ITEMS_PER_CHUNK = Math.max(1, Math.floor(MAX_ROWS_PER_CHUNK / ASSUMED_ORG_COUNT));

export function odooListName(nombreLista) {
  return `ODOO — ${nombreLista}`;
}

/** Escapa comillas simples para literales SQL (' → ''). */
export function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

/** Slug corto para nombres de archivo (solo diagnóstico/legibilidad). */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos (diacríticos combinantes)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * 000_listas.sql — upsert de las N ServicePriceList (una por lista Odoo)
 * para cada org real. Idempotente: WHERE NOT EXISTS por (organizationId, name).
 * createdAt/updatedAt tienen DEFAULT now() en el DDL (sql/133) — no son
 * estrictamente requeridos, pero se setean explícitos por claridad/certeza.
 *
 * @param {{ extraido: string }} dump
 * @param {Array<{ id: number, name: string }>} listas
 * @returns {string}
 */
export function buildListasSql(dump, listas) {
  const values = listas
    .map((l) => {
      const name = sqlEscape(odooListName(l.name));
      const notes = sqlEscape(`Importado de Odoo (lista_id=${l.id}, extraído ${dump.extraido})`);
      return `    ('${name}', '${notes}')`;
    })
    .join(",\n");

  return `-- =============================================================================
-- 000_listas.sql (emitido por seed-tarifario-odoo.mjs --emit-sql)
-- CC-0015 — Upsert de ${listas.length} ServicePriceList (una por lista Odoo) para
-- cada organización real (legalName NOT LIKE 'RLS-Test%').
-- Idempotente: WHERE NOT EXISTS por ("organizationId", name).
-- Requiere sql/191_cc0015_tipo_cuenta_listas_precios.sql ya aplicado (define
-- TipoCuenta + el índice único parcial de ServicePriceListItem).
-- Aplicar ANTES que los archivos NNN_items_*.sql y 999_vincular_tipos.sql.
-- =============================================================================

INSERT INTO "ServicePriceList" ("organizationId", name, "currencyId", "validFrom", active, notes, "createdAt", "updatedAt")
SELECT o.id, v.name, (SELECT id FROM "Currency" WHERE "isoCode" = 'USD' LIMIT 1), CURRENT_DATE, true, v.notes, now(), now()
FROM "Organization" o
CROSS JOIN (VALUES
${values}
) AS v(name, notes)
WHERE o."legalName" NOT LIKE 'RLS-Test%'
  AND NOT EXISTS (
    SELECT 1 FROM "ServicePriceList" pl
    WHERE pl."organizationId" = o.id AND pl.name = v.name
  );
`;
}

/**
 * NNN_items_*.sql — upsert de ServicePriceListItem en chunks de máximo
 * `ITEMS_PER_CHUNK` filas VALUES (≈ MAX_ROWS_PER_CHUNK filas resultantes
 * asumiendo ASSUMED_ORG_COUNT orgs reales — ver comentario junto a la
 * constante). Cada fila trae el nombre de la lista; el JOIN por nombre
 * contra "ServicePriceList" multiplica automáticamente por cada org real
 * que ya tenga esa lista (creada por 000_listas.sql), sin necesidad de
 * conocer los org id en tiempo de generación.
 *
 * ON CONFLICT contra el índice único PARCIAL ux_spl_item_list_code exige
 * repetir su cláusula WHERE en el conflict target.
 *
 * @param {Array<{ name: string, items: Array<{code:string, description:string, unitPrice:number}> }>} listas
 * @returns {Array<{ filename: string, sql: string, itemCount: number, listasEnChunk: string[] }>}
 */
export function buildItemsChunks(listas) {
  // Aplana todos los items con su nombre de lista, preservando el orden de `listas`.
  const flat = [];
  for (const lista of listas) {
    for (const item of lista.items) {
      flat.push({ listaName: odooListName(lista.name), ...item });
    }
  }

  const chunks = [];
  for (let i = 0; i < flat.length; i += ITEMS_PER_CHUNK) {
    chunks.push(flat.slice(i, i + ITEMS_PER_CHUNK));
  }

  return chunks.map((chunkItems, idx) => {
    const seq = String(idx + 1).padStart(3, "0");
    const firstListaSlug = slugify(chunkItems[0].listaName.replace(/^ODOO — /, ""));
    const filename = `${seq}_items_${firstListaSlug}.sql`;

    const values = chunkItems
      .map((it) => {
        const listaName = sqlEscape(it.listaName);
        const code = sqlEscape(it.code);
        const description = sqlEscape(it.description);
        const unitPrice = Number(it.unitPrice).toFixed(2);
        return `    ('${listaName}', '${code}', '${description}', ${unitPrice})`;
      })
      .join(",\n");

    const listasEnChunk = [...new Set(chunkItems.map((it) => it.listaName))];

    const sql = `-- =============================================================================
-- ${filename} (emitido por seed-tarifario-odoo.mjs --emit-sql)
-- CC-0015 — Chunk ${idx + 1}/${chunks.length} — ${chunkItems.length} items ×
-- org real (asume ${ASSUMED_ORG_COUNT} orgs reales hoy en prod → ~${chunkItems.length * ASSUMED_ORG_COUNT} filas).
-- Listas cubiertas en este chunk: ${listasEnChunk.join(" | ")}
-- Requiere 000_listas.sql ya aplicado.
-- Idempotente: ON CONFLICT ("priceListId", code) WHERE code IS NOT NULL DO UPDATE.
-- =============================================================================

INSERT INTO "ServicePriceListItem" ("priceListId", code, description, "unitPrice", active, "updatedAt")
SELECT pl.id, v.code, v.description, v.unit_price::numeric(14,2), true, now()
FROM (VALUES
${values}
) AS v(lista_name, code, description, unit_price)
JOIN "ServicePriceList" pl ON pl.name = v.lista_name
ON CONFLICT ("priceListId", code) WHERE code IS NOT NULL DO UPDATE SET
  description = EXCLUDED.description,
  "unitPrice" = EXCLUDED."unitPrice",
  active = true,
  "updatedAt" = now();
`;

    return { filename, sql, itemCount: chunkItems.length, listasEnChunk };
  });
}

/**
 * 999_vincular_tipos.sql — enlaza TipoCuenta.priceListId → ServicePriceList
 * según TIPO_CUENTA_A_LISTA, para todas las orgs reales a la vez (join por
 * organizationId real entre TipoCuenta y ServicePriceList).
 *
 * @returns {string}
 */
export function buildVincularTiposSql() {
  const values = Object.entries(TIPO_CUENTA_A_LISTA)
    .map(([code, nombreLista]) => {
      const listaName = sqlEscape(odooListName(nombreLista));
      return `    ('${sqlEscape(code)}', '${listaName}')`;
    })
    .join(",\n");

  return `-- =============================================================================
-- 999_vincular_tipos.sql (emitido por seed-tarifario-odoo.mjs --emit-sql)
-- CC-0015 — Enlaza TipoCuenta."priceListId" -> ServicePriceList.id según el
-- mapa código-tipo -> nombre-lista (TIPO_CUENTA_A_LISTA). Aplica a todas las
-- orgs reales que ya tengan sembrado TipoCuenta (sql/191) y la lista
-- correspondiente (000_listas.sql).
-- Requiere 000_listas.sql ya aplicado. Idempotente (UPDATE puro, reejecutable).
-- =============================================================================

UPDATE "TipoCuenta" tc
   SET "priceListId" = pl.id, "updatedAt" = now()
  FROM "ServicePriceList" pl
  JOIN (VALUES
${values}
  ) AS m(code, lista_name) ON pl.name = m.lista_name
 WHERE tc."organizationId" = pl."organizationId"
   AND tc.code = m.code;
`;
}
