/**
 * CC-0015 — Tests unitarios del emisor de SQL estático para el tarifario
 * Odoo (modo `--emit-sql`). Puro: no toca BD ni el dump real.
 */
import { describe, it, expect } from "vitest";
import {
  TIPO_CUENTA_A_LISTA,
  ITEMS_PER_CHUNK,
  ASSUMED_ORG_COUNT,
  odooListName,
  sqlEscape,
  slugify,
  buildListasSql,
  buildItemsChunks,
  buildVincularTiposSql,
} from "../lib/odoo-tarifario-sql.mjs";

describe("sqlEscape", () => {
  it("escapa comillas simples duplicándolas", () => {
    expect(sqlEscape("O'Brien's")).toBe("O''Brien''s");
  });

  it("no toca strings sin comillas", () => {
    expect(sqlEscape("ABRILAR EA 575")).toBe("ABRILAR EA 575");
  });
});

describe("slugify", () => {
  it("produce un slug en minúsculas separado por guiones", () => {
    expect(slugify("PRECIOS ISBM")).toBe("precios-isbm");
  });

  it("quita acentos", () => {
    expect(slugify("DrSV - IMÁGENES")).toBe("drsv-imagenes");
  });

  it("trunca a 40 caracteres", () => {
    expect(slugify("X".repeat(100)).length).toBeLessThanOrEqual(40);
  });
});

describe("buildListasSql", () => {
  const dump = { extraido: "2026-08-04T16:17:31.395Z" };
  const listas = [
    { id: 1, name: "Precios Avante Complejo Hospitalario" },
    { id: 48, name: "PRECIOS ISBM" },
  ];

  it("genera un INSERT idempotente con WHERE NOT EXISTS por (organizationId, name)", () => {
    const sql = buildListasSql(dump, listas);

    expect(sql).toContain('INSERT INTO "ServicePriceList"');
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain('pl."organizationId" = o.id AND pl.name = v.name');
    expect(sql).toContain("legalName\" NOT LIKE 'RLS-Test%'");
  });

  it("incluye el nombre ODOO — prefijado de cada lista", () => {
    const sql = buildListasSql(dump, listas);
    expect(sql).toContain("'ODOO — Precios Avante Complejo Hospitalario'");
    expect(sql).toContain("'ODOO — PRECIOS ISBM'");
  });

  it("resuelve currencyId USD con subquery, no parámetro", () => {
    const sql = buildListasSql(dump, listas);
    expect(sql).toContain(`(SELECT id FROM "Currency" WHERE "isoCode" = 'USD' LIMIT 1)`);
  });
});

describe("buildItemsChunks", () => {
  it("respeta ITEMS_PER_CHUNK como tamaño máximo de VALUES por archivo", () => {
    const items = Array.from({ length: ITEMS_PER_CHUNK + 5 }, (_, i) => ({
      code: `C${i}`,
      description: `Item ${i}`,
      unitPrice: 1.5,
    }));
    const listas = [{ name: "PRECIOS ISBM", items }];

    const chunks = buildItemsChunks(listas);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].itemCount).toBe(ITEMS_PER_CHUNK);
    expect(chunks[1].itemCount).toBe(5);
  });

  it("el SQL generado usa ON CONFLICT con la cláusula WHERE del índice parcial", () => {
    const listas = [{ name: "PRECIOS ISBM", items: [{ code: "A1", description: "Item A", unitPrice: 10 }] }];
    const [chunk] = buildItemsChunks(listas);

    expect(chunk.sql).toContain('ON CONFLICT ("priceListId", code) WHERE code IS NOT NULL DO UPDATE SET');
    expect(chunk.sql).toContain('JOIN "ServicePriceList" pl ON pl.name = v.lista_name');
  });

  it("escapa comillas simples en description y code", () => {
    const listas = [
      { name: "PRECIOS ISBM", items: [{ code: "A'1", description: "Item's \"A\"", unitPrice: 10 }] },
    ];
    const [chunk] = buildItemsChunks(listas);

    expect(chunk.sql).toContain("'A''1'");
    expect(chunk.sql).toContain("Item''s");
  });

  it("formatea unitPrice con 2 decimales sin comillas", () => {
    const listas = [{ name: "PRECIOS ISBM", items: [{ code: "A1", description: "Item A", unitPrice: 4.5 }] }];
    const [chunk] = buildItemsChunks(listas);

    expect(chunk.sql).toContain("'Item A', 4.50)");
  });

  it("nombra los archivos NNN_items_<slug>.sql en orden secuencial", () => {
    const items = Array.from({ length: ITEMS_PER_CHUNK + 1 }, (_, i) => ({
      code: `C${i}`,
      description: `Item ${i}`,
      unitPrice: 1,
    }));
    const chunks = buildItemsChunks([{ name: "PRECIOS ISBM", items }]);

    expect(chunks[0].filename).toBe("001_items_precios-isbm.sql");
    expect(chunks[1].filename).toBe("002_items_precios-isbm.sql");
  });

  it("no genera chunks para listas sin items", () => {
    const chunks = buildItemsChunks([{ name: "SIN ITEMS", items: [] }]);
    expect(chunks).toHaveLength(0);
  });
});

describe("buildVincularTiposSql", () => {
  it("incluye los 16 mapeos tipo→lista con nombre ODOO — prefijado", () => {
    const sql = buildVincularTiposSql();
    const mappingsCount = Object.keys(TIPO_CUENTA_A_LISTA).length;

    expect(mappingsCount).toBe(16);
    for (const [code, nombreLista] of Object.entries(TIPO_CUENTA_A_LISTA)) {
      expect(sql).toContain(`'${code}'`);
      expect(sql).toContain(`'${odooListName(nombreLista)}'`);
    }
  });

  it("es un UPDATE idempotente scoped por organizationId real", () => {
    const sql = buildVincularTiposSql();
    expect(sql).toContain('UPDATE "TipoCuenta" tc');
    expect(sql).toContain('tc."organizationId" = pl."organizationId"');
  });
});

describe("constantes de chunking", () => {
  it("ITEMS_PER_CHUNK × ASSUMED_ORG_COUNT no supera 400 filas", () => {
    expect(ITEMS_PER_CHUNK * ASSUMED_ORG_COUNT).toBeLessThanOrEqual(400);
  });
});
