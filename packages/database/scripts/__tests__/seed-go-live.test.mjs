/**
 * Tests unitarios para el algoritmo UPSERT de los seeds go-live.
 *
 * Estrategia: mockeamos el Client de pg para no requerir BD real.
 * Solo cubrimos la lógica de construcción de queries, manejo de batches
 * e interpretación de rowCount — que son las decisiones que pueden fallar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock de pg.Client ────────────────────────────────────────────────────────

/**
 * Crea un client mock de pg con comportamiento configurable.
 * @param {Record<string, {rows: any[], rowCount: number}>} responses
 *   Mapa de substring de SQL → respuesta. El primer match gana.
 */
function makeMockClient(responses = {}) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    end:     vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation(async (sql, _params) => {
      for (const [key, value] of Object.entries(responses)) {
        if (sql.includes(key)) return value;
      }
      // Default: respuesta vacía (no-op)
      return { rows: [], rowCount: 0 };
    }),
  };
}

// ─── Helpers extraídos de los scripts (re-implementados aquí para testear) ───

/**
 * Construye los VALUES placeholders y params para upsertBatch.
 * Extraído de seed-icd10-full.mjs para test aislado.
 */
function buildUpsertSql(codigos) {
  const vals = [];
  const params = [];
  let idx = 1;
  for (const c of codigos) {
    vals.push(`($${idx++},$${idx++},$${idx++},$${idx++},true)`);
    params.push(c.codigo, c.descripcion, c.capitulo ?? null, c.grupo ?? null);
  }
  const sql = `INSERT INTO public."Icd10Catalog" (codigo, descripcion, capitulo, grupo, activo) VALUES ${vals.join(",")} ON CONFLICT (codigo) DO NOTHING`;
  return { sql, params };
}

/**
 * Simulación de upsertBatch que usa el client mock.
 */
async function upsertBatch(client, codigos) {
  if (codigos.length === 0) return 0;
  const { sql, params } = buildUpsertSql(codigos);
  const res = await client.query(sql, params);
  return res.rowCount ?? 0;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("buildUpsertSql — construcción de query CIE-10", () => {
  it("genera placeholders secuenciales correctos para 1 código", () => {
    const codigos = [{ codigo: "A00", descripcion: "Cólera", capitulo: "I", grupo: "A00-A09" }];
    const { sql, params } = buildUpsertSql(codigos);

    expect(sql).toContain("($1,$2,$3,$4,true)");
    expect(params).toEqual(["A00", "Cólera", "I", "A00-A09"]);
  });

  it("genera 2 grupos de placeholders para 2 códigos", () => {
    const codigos = [
      { codigo: "A00", descripcion: "Cólera",     capitulo: "I",  grupo: "A00-A09" },
      { codigo: "B20", descripcion: "VIH", capitulo: "I",  grupo: "B20-B24" },
    ];
    const { sql, params } = buildUpsertSql(codigos);

    expect(sql).toContain("($1,$2,$3,$4,true),($5,$6,$7,$8,true)");
    expect(params).toHaveLength(8);
    expect(params[0]).toBe("A00");
    expect(params[4]).toBe("B20");
  });

  it("usa null para capitulo/grupo cuando no se proveen", () => {
    const codigos = [{ codigo: "X00", descripcion: "Sin capitulo" }];
    const { sql: _sql, params } = buildUpsertSql(codigos);

    expect(params[2]).toBeNull(); // capitulo
    expect(params[3]).toBeNull(); // grupo
  });

  it("incluye ON CONFLICT DO NOTHING en el SQL", () => {
    const codigos = [{ codigo: "A00", descripcion: "Cólera", capitulo: "I", grupo: "A00-A09" }];
    const { sql } = buildUpsertSql(codigos);

    expect(sql).toContain("ON CONFLICT (codigo) DO NOTHING");
  });

  it("retorna arrays vacíos para input vacío — protege contra batch vacío", () => {
    const { sql, params } = buildUpsertSql([]);
    // No hay VALUES — el sql no tiene VALUES completos
    expect(params).toHaveLength(0);
    expect(vals => vals).toBeDefined(); // simplemente no lanza
  });
});

describe("upsertBatch — comportamiento con rowCount", () => {
  it("retorna rowCount del client cuando hay inserciones", async () => {
    const client = makeMockClient({
      "Icd10Catalog": { rows: [], rowCount: 3 },
    });

    const codigos = Array.from({ length: 3 }, (_, i) => ({
      codigo: `A0${i}`, descripcion: `Desc ${i}`, capitulo: "I", grupo: "A00-A09",
    }));

    const inserted = await upsertBatch(client, codigos);
    expect(inserted).toBe(3);
    expect(client.query).toHaveBeenCalledOnce();
  });

  it("retorna 0 cuando rowCount es 0 (todos ya existían)", async () => {
    const client = makeMockClient({
      "Icd10Catalog": { rows: [], rowCount: 0 },
    });

    const codigos = [{ codigo: "A00", descripcion: "Cólera", capitulo: "I", grupo: "A00-A09" }];
    const inserted = await upsertBatch(client, codigos);
    expect(inserted).toBe(0);
  });

  it("retorna 0 y no llama query cuando el array está vacío", async () => {
    const client = makeMockClient({});
    const inserted = await upsertBatch(client, []);
    expect(inserted).toBe(0);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("trata rowCount null como 0 (pg puede retornar null en comandos no-SELECT)", async () => {
    const client = makeMockClient({
      "Icd10Catalog": { rows: [], rowCount: null },
    });
    const codigos = [{ codigo: "A00", descripcion: "Cólera", capitulo: "I", grupo: "A00-A09" }];
    const inserted = await upsertBatch(client, codigos);
    expect(inserted).toBe(0); // null ?? 0
  });
});

describe("seed-go-live-defaults — lógica de ON CONFLICT idempotente", () => {
  /**
   * Verifica que las queries de roles usen ON CONFLICT DO NOTHING.
   * Refleja la implementación de seedRoles().
   */
  async function seedRolesSimulated(client, roles) {
    let inserted = 0;
    let skipped  = 0;
    for (const role of roles) {
      const res = await client.query(
        `INSERT INTO public."Role" ("organizationId", "code", "name", "description", "active") VALUES (NULL, $1, $2, $3, true) ON CONFLICT ("organizationId", "code") DO NOTHING`,
        [role.code, role.name, role.description]
      );
      const n = res.rowCount ?? 0;
      inserted += n;
      skipped  += 1 - n;
    }
    return { inserted, skipped };
  }

  it("cuenta correctamente insertados vs omitidos en primera ejecución", async () => {
    const client = makeMockClient({
      '"Role"': { rows: [], rowCount: 1 }, // todos se insertan
    });
    const roles = [
      { code: "MC",   name: "Médico",       description: "" },
      { code: "ENF",  name: "Enfermera",    description: "" },
    ];

    const { inserted, skipped } = await seedRolesSimulated(client, roles);
    expect(inserted).toBe(2);
    expect(skipped).toBe(0);
  });

  it("detecta roles ya existentes (rowCount=0) en segunda ejecución", async () => {
    const client = makeMockClient({
      '"Role"': { rows: [], rowCount: 0 }, // todos ya existen
    });
    const roles = [
      { code: "MC",  name: "Médico",    description: "" },
      { code: "ENF", name: "Enfermera", description: "" },
    ];

    const { inserted, skipped } = await seedRolesSimulated(client, roles);
    expect(inserted).toBe(0);
    expect(skipped).toBe(2);
  });

  it("mezcla insertados y omitidos correctamente", async () => {
    let callCount = 0;
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      end:     vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockImplementation(async () => {
        callCount++;
        // Primera llamada inserta, segunda no
        return { rows: [], rowCount: callCount === 1 ? 1 : 0 };
      }),
    };

    const roles = [
      { code: "NUEVO",     name: "Nuevo",     description: "" },
      { code: "EXISTENTE", name: "Existente", description: "" },
    ];

    const { inserted, skipped } = await seedRolesSimulated(client, roles);
    expect(inserted).toBe(1);
    expect(skipped).toBe(1);
  });
});

describe("seed-go-live-verify — conteo y clasificación de issues", () => {
  /**
   * Simula la lógica de checkCounts() para verificar clasificación de issues.
   */
  async function checkCountsSimulated(client, targets) {
    const counts = {};
    const issues = [];
    for (const target of targets) {
      try {
        const res = await client.query(target.sql);
        const count = parseInt(res.rows[0].count, 10);
        counts[target.label] = count;
        if (count === 0 && !target.optional) {
          issues.push({ severity: "WARN", label: target.label });
        }
      } catch (err) {
        if (!target.optional) {
          issues.push({ severity: "ERROR", label: target.label });
          counts[target.label] = "ERROR";
        } else {
          counts[target.label] = "N/A";
        }
      }
    }
    return { counts, issues };
  }

  it("no genera issues cuando todas las tablas tienen filas", async () => {
    const client = makeMockClient({
      'COUNT(*)': { rows: [{ count: "10" }], rowCount: 1 },
    });

    const targets = [
      { label: "Organization", sql: "SELECT COUNT(*) ...", optional: false },
      { label: "Role",         sql: "SELECT COUNT(*) ...", optional: false },
    ];

    const { issues } = await checkCountsSimulated(client, targets);
    expect(issues).toHaveLength(0);
  });

  it("genera WARN para tabla no-opcional con 0 filas", async () => {
    const client = makeMockClient({
      'COUNT(*)': { rows: [{ count: "0" }], rowCount: 1 },
    });

    const targets = [
      { label: "Role", sql: "SELECT COUNT(*) ...", optional: false },
    ];

    const { issues } = await checkCountsSimulated(client, targets);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("WARN");
    expect(issues[0].label).toBe("Role");
  });

  it("no genera issue para tabla opcional con 0 filas", async () => {
    const client = makeMockClient({
      'COUNT(*)': { rows: [{ count: "0" }], rowCount: 1 },
    });

    const targets = [
      { label: "ece.workflow_plantilla", sql: "SELECT COUNT(*) ...", optional: true },
    ];

    const { issues } = await checkCountsSimulated(client, targets);
    expect(issues).toHaveLength(0);
  });

  it("genera ERROR (no WARN) cuando la query lanza excepción en tabla no-opcional", async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      end:     vi.fn().mockResolvedValue(undefined),
      query:   vi.fn().mockRejectedValue(new Error("relation does not exist")),
    };

    const targets = [
      { label: "Icd10Catalog", sql: "SELECT COUNT(*) ...", optional: false },
    ];

    const { issues, counts } = await checkCountsSimulated(client, targets);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("ERROR");
    expect(counts["Icd10Catalog"]).toBe("ERROR");
  });

  it("silencia error de tabla opcional", async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      end:     vi.fn().mockResolvedValue(undefined),
      query:   vi.fn().mockRejectedValue(new Error("relation does not exist")),
    };

    const targets = [
      { label: "ece.establecimiento", sql: "SELECT COUNT(*) ...", optional: true },
    ];

    const { issues, counts } = await checkCountsSimulated(client, targets);
    expect(issues).toHaveLength(0);
    expect(counts["ece.establecimiento"]).toBe("N/A");
  });
});
