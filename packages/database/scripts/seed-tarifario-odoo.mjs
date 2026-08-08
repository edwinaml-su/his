#!/usr/bin/env node
/**
 * CC-0015 — Seed de tarifario desde el dump de listas de precios de Odoo.
 *
 * Fuente: docs/CC/0015/odoo-pricelists-dump.json (20 listas, 3610 reglas,
 * extraído de https://odoo.complejoavante.com el 2026-08-04).
 *
 * Por cada organización real (legalName NOT LIKE 'RLS-Test%') × cada una de
 * las 20 listas del dump:
 *   - upsert "ServicePriceList" (name = "ODOO — {nombre lista}", USD,
 *     validFrom = hoy, notes = referencia al lista_id de origen).
 *   - upsert "ServicePriceListItem" por (priceListId, code) — el índice único
 *     parcial ux_spl_item_list_code (sql/191) hace el upsert idempotente.
 *
 * Tras crear las listas, enlaza "TipoCuenta"."priceListId" según el mapa
 * TIPO_CUENTA_A_LISTA (ISBM → "ODOO — PRECIOS ISBM", etc.). PARTICULAR →
 * "ODOO — Precios Avante Complejo Hospitalario".
 *
 * Reglas omitidas (no generan item): tipo !== 'fixed' (formula) o
 * aplica === '2_product_category' (regla de categoría completa, sin
 * producto). En el dump actual son las mismas 2 reglas (ambas condiciones
 * coinciden). También se cuentan duplicados de (lista, code) — se conserva
 * la última regla del dump (tiers por min_qty).
 *
 * Uso:
 *   node --env-file=.env.local packages/database/scripts/seed-tarifario-odoo.mjs --dry-run
 *   node --env-file=.env.local packages/database/scripts/seed-tarifario-odoo.mjs
 *
 *   # Modo alterno cuando Prisma no tiene DATABASE_URL válido (credenciales
 *   # Sensitive en Vercel): emite SQL estático idempotente para aplicar vía
 *   # Supabase MCP (execute_sql / apply_migration). NO toca BD, NO requiere
 *   # DATABASE_URL ni conectividad — puede correr con `node` plano.
 *   node packages/database/scripts/seed-tarifario-odoo.mjs --emit-sql <dir>
 *
 * IMPORTANTE: este script lo ejecuta el orquestador. El agente que lo generó
 * (@Dev/@DBA) solo tiene autorizado correr --dry-run / --emit-sql (nunca la
 * corrida real contra BD).
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// PrismaClient se importa dinámicamente solo en runDryRun/runReal (abajo) —
// --emit-sql no toca BD y no debe pagar el costo (ni el riesgo de resolución
// ESM del paquete @his/database) de esa importación.
import { esReglaAplicable, reglasAItems } from "./lib/odoo-tarifario-parser.mjs";
import {
  TIPO_CUENTA_A_LISTA,
  ASSUMED_ORG_COUNT,
  odooListName,
  buildListasSql,
  buildItemsChunks,
  buildVincularTiposSql,
} from "./lib/odoo-tarifario-sql.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DUMP_PATH = join(here, "..", "..", "..", "docs", "CC", "0015", "odoo-pricelists-dump.json");

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 200;

const EMIT_SQL_FLAG_IDX = process.argv.indexOf("--emit-sql");
const EMIT_SQL_DIR = EMIT_SQL_FLAG_IDX >= 0 ? process.argv[EMIT_SQL_FLAG_IDX + 1] : null;

/** Agrupa reglas por lista_id y las convierte en items deduplicados. */
function construirListasConItems(dump) {
  const reglasPorLista = new Map();
  for (const regla of dump.reglas) {
    if (!reglasPorLista.has(regla.lista_id)) reglasPorLista.set(regla.lista_id, []);
    reglasPorLista.get(regla.lista_id).push(regla);
  }

  let totalOmitidas = 0;
  let totalDuplicados = 0;

  const listas = dump.listas.map((lista) => {
    const reglas = reglasPorLista.get(lista.id) ?? [];
    const omitidas = reglas.filter((r) => !esReglaAplicable(r)).length;
    const { items, duplicatesSkipped } = reglasAItems(reglas);
    totalOmitidas += omitidas;
    totalDuplicados += duplicatesSkipped;
    return { id: lista.id, name: lista.name, reglasCount: reglas.length, items };
  });

  return { listas, totalOmitidas, totalDuplicados };
}

// =============================================================================
// Modo real (Prisma) — upsertLista / upsertItems / enlazarTiposCuenta
// =============================================================================

/** Upsert de "ServicePriceList" para una org+lista. Retorna el id. */
async function upsertLista(prisma, organizationId, nombreListaOdoo, listaIdOrigen, currencyId, extraido) {
  const name = odooListName(nombreListaOdoo);
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "ServicePriceList" ("organizationId", name, "currencyId", "validFrom", active, notes)
     VALUES ($1::uuid, $2, $3::uuid, CURRENT_DATE, true, $4)
     ON CONFLICT ("organizationId", name) DO UPDATE SET
       "currencyId" = EXCLUDED."currencyId",
       "updatedAt" = now()
     RETURNING id`,
    organizationId,
    name,
    currencyId,
    `Importado de Odoo (lista_id=${listaIdOrigen}, extraído ${extraido})`,
  );
  return rows[0].id;
}

/** Upsert en lotes de "ServicePriceListItem" por (priceListId, code). */
async function upsertItems(prisma, priceListId, items) {
  let upserted = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    if (batch.length === 0) continue;

    const values = [];
    const params = [];
    let idx = 1;
    for (const item of batch) {
      values.push(`($${idx++}::uuid, $${idx++}, $${idx++}, $${idx++}::numeric, true)`);
      params.push(priceListId, item.code, item.description, item.unitPrice);
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO "ServicePriceListItem" ("priceListId", code, description, "unitPrice", active)
       VALUES ${values.join(", ")}
       ON CONFLICT ("priceListId", code) WHERE code IS NOT NULL DO UPDATE SET
         description = EXCLUDED.description,
         "unitPrice" = EXCLUDED."unitPrice",
         "updatedAt" = now()`,
      ...params,
    );
    upserted += batch.length;
  }
  return upserted;
}

/** Enlaza TipoCuenta.priceListId → ServicePriceList según TIPO_CUENTA_A_LISTA (todas las orgs a la vez). */
async function enlazarTiposCuenta(prisma) {
  let enlazados = 0;
  for (const [code, nombreLista] of Object.entries(TIPO_CUENTA_A_LISTA)) {
    const name = odooListName(nombreLista);
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "TipoCuenta" tc
          SET "priceListId" = pl.id, "updatedAt" = now()
         FROM "ServicePriceList" pl
        WHERE pl."organizationId" = tc."organizationId"
          AND pl.name = $1
          AND tc.code = $2`,
      name,
      code,
    );
    enlazados += Number(result);
  }
  return enlazados;
}

async function runDryRun(dump, listas, totalOmitidas, totalDuplicados) {
  console.log("\n--- Resumen por lista (parseo en seco del dump) ---");
  for (const l of listas) {
    console.log(`  [${l.id}] ${l.name} — ${l.reglasCount} reglas → ${l.items.length} items`);
  }
  console.log(`\nReglas omitidas (formula / categoría completa): ${totalOmitidas}`);
  console.log(`Duplicados (mismo code en la misma lista, se conserva el último): ${totalDuplicados}`);

  // Validaciones que no requieren BD — corren siempre, con o sin conectividad.
  console.log("\n--- Muestras de items (primeros 3 por lista, solo listas con items) ---");
  for (const l of listas.filter((x) => x.items.length > 0).slice(0, 5)) {
    console.log(`  ${odooListName(l.name)}:`);
    for (const item of l.items.slice(0, 3)) {
      console.log(`    [${item.code}] ${item.description} — $${item.unitPrice.toFixed(2)}`);
    }
  }

  console.log("\n--- Mapa TipoCuenta → lista (validación de nombres) ---");
  const nombresListas = new Set(listas.map((l) => l.name));
  for (const [code, nombreLista] of Object.entries(TIPO_CUENTA_A_LISTA)) {
    const ok = nombresListas.has(nombreLista);
    console.log(`  ${code} → "${nombreLista}" ${ok ? "OK" : "*** NO ENCONTRADA EN EL DUMP ***"}`);
  }

  // Validación contra BD (conteo de orgs reales) — solo si hay conectividad.
  // Import dinámico: si la resolución ESM de @his/database falla o
  // DATABASE_URL es inválido, cae al catch de abajo.
  let prisma;
  try {
    const { PrismaClient } = await import("@his/database");
    prisma = new PrismaClient();
    const orgs = await prisma.organization.findMany({
      where: { NOT: { legalName: { startsWith: "RLS-Test" } } },
      select: { id: true, legalName: true },
    });

    console.log(`\n--- Dry-run contra BD: ${orgs.length} organizaciones reales ---`);
    for (const org of orgs) {
      console.log(`  ${org.legalName}: se crearían/actualizarían ${listas.length} listas.`);
    }

    const totalItems = listas.reduce((acc, l) => acc + l.items.length, 0);
    console.log(`\nTotal proyectado: ${orgs.length} orgs × ${listas.length} listas`);
    console.log(`Total items a upsert (todas las orgs): ${orgs.length * totalItems}`);
  } catch (err) {
    console.log(
      `\nNo se pudo validar contra BD (${err.message}). ` +
        "Validación en seco (solo parseo del dump) completada arriba.",
    );
  } finally {
    await prisma?.$disconnect();
  }

  console.log("\nDRY-RUN completo. No se escribió nada.");
}

async function runReal(dump, listas) {
  const { PrismaClient } = await import("@his/database");
  const prisma = new PrismaClient();
  try {
    const currency = await prisma.currency.findFirst({ where: { isoCode: "USD" } });
    if (!currency) {
      throw new Error('Moneda USD no encontrada en "Currency". Sembrar catálogo de monedas primero.');
    }

    const orgs = await prisma.organization.findMany({
      where: { NOT: { legalName: { startsWith: "RLS-Test" } } },
      select: { id: true, legalName: true },
    });
    console.log(`Organizaciones reales: ${orgs.length}`);

    let listasCreadas = 0;
    let itemsUpserted = 0;

    for (const org of orgs) {
      for (const lista of listas) {
        const priceListId = await upsertLista(
          prisma,
          org.id,
          lista.name,
          lista.id,
          currency.id,
          dump.extraido,
        );
        listasCreadas++;
        const upserted = await upsertItems(prisma, priceListId, lista.items);
        itemsUpserted += upserted;
      }
      console.log(`  ${org.legalName}: ${listas.length} listas procesadas.`);
    }

    const tiposEnlazados = await enlazarTiposCuenta(prisma);

    console.log("\n--- Resumen ---");
    console.log(`Listas creadas/actualizadas: ${listasCreadas}`);
    console.log(`Items upserted: ${itemsUpserted}`);
    console.log(`TipoCuenta.priceListId enlazados: ${tiposEnlazados}`);
  } finally {
    await prisma.$disconnect();
  }
}

// =============================================================================
// Modo --emit-sql — genera SQL estático idempotente para aplicar vía MCP
// (sin tocar BD). Usado cuando DATABASE_URL local no tiene credenciales
// válidas (password real es Sensitive en Vercel). La construcción del SQL
// vive en ./lib/odoo-tarifario-sql.mjs (testeable sin BD); esta función solo
// escribe los archivos a disco y reporta.
// =============================================================================

async function runEmitSql(dump, listas, outDir) {
  mkdirSync(outDir, { recursive: true });

  const filesWritten = [];

  // 000_listas.sql
  const listasSql = buildListasSql(dump, listas);
  writeFileSync(join(outDir, "000_listas.sql"), listasSql, "utf8");
  filesWritten.push({ filename: "000_listas.sql", rows: listas.length, note: `${listas.length} listas × org real` });

  // NNN_items_*.sql
  const chunks = buildItemsChunks(listas);
  for (const chunk of chunks) {
    writeFileSync(join(outDir, chunk.filename), chunk.sql, "utf8");
    filesWritten.push({
      filename: chunk.filename,
      rows: chunk.itemCount,
      note: `${chunk.itemCount} items × org real (~${chunk.itemCount * ASSUMED_ORG_COUNT} filas asumiendo ${ASSUMED_ORG_COUNT} orgs)`,
    });
  }

  // 999_vincular_tipos.sql
  const vincularSql = buildVincularTiposSql();
  writeFileSync(join(outDir, "999_vincular_tipos.sql"), vincularSql, "utf8");
  filesWritten.push({
    filename: "999_vincular_tipos.sql",
    rows: Object.keys(TIPO_CUENTA_A_LISTA).length,
    note: `${Object.keys(TIPO_CUENTA_A_LISTA).length} mapeos tipo→lista × org real`,
  });

  const totalItems = listas.reduce((acc, l) => acc + l.items.length, 0);

  console.log(`\n--- SQL emitido a: ${outDir} ---`);
  for (const f of filesWritten) {
    console.log(`  ${f.filename} — ${f.rows} filas VALUES (${f.note})`);
  }
  console.log(`\nTotal archivos: ${filesWritten.length}`);
  console.log(`Total items (sin multiplicar por org): ${totalItems}`);
  console.log(
    `Total estimado de filas ServicePriceListItem (asumiendo ${ASSUMED_ORG_COUNT} orgs reales): ${totalItems * ASSUMED_ORG_COUNT}`,
  );
  console.log("\nOrden de aplicación (MCP execute_sql / apply_migration):");
  console.log("  1. 000_listas.sql");
  console.log(`  2. 001_items_*.sql .. ${String(chunks.length).padStart(3, "0")}_items_*.sql (en cualquier orden entre sí)`);
  console.log("  3. 999_vincular_tipos.sql");
  console.log("\nNo se tocó la base de datos.");
}

async function main() {
  const dump = JSON.parse(readFileSync(DUMP_PATH, "utf8"));
  console.log(`Dump: ${dump.listas.length} listas, ${dump.total_reglas} reglas (extraído ${dump.extraido})`);

  const { listas, totalOmitidas, totalDuplicados } = construirListasConItems(dump);

  if (EMIT_SQL_DIR) {
    console.log(`Reglas omitidas: ${totalOmitidas} | Duplicados: ${totalDuplicados}`);
    await runEmitSql(dump, listas, EMIT_SQL_DIR);
    return;
  }

  if (DRY_RUN) {
    await runDryRun(dump, listas, totalOmitidas, totalDuplicados);
    return;
  }

  await runReal(dump, listas);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export { construirListasConItems };
