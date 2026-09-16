/**
 * Guarda de regresión — barrido 42883 `uuid = text` en raw SQL
 * (FIX-establishment-list-uuid §3.4, 2026-09-16).
 *
 * `$queryRawUnsafe`/`$executeRawUnsafe` envían los parámetros posicionales
 * como `text`; Postgres no coerciona `uuid = text` (42883) en contexto de
 * comparación (WHERE/JOIN/AND/OR), aunque sí lo hace en asignación
 * (INSERT/UPDATE SET, que están fuera de alcance de esta guarda). El barrido
 * de 2026-09-16 cerró ~50 sitios en 15 archivos — ver PR de
 * FIX-establishment-list-uuid §3.4 para el inventario completo.
 *
 * Esta guarda solo cubre columnas *inequívocamente* uuid en todo
 * `schema.prisma` (cero modelos donde el mismo nombre de campo sea un tipo
 * distinto — verificado contra las 337 columnas `@db.Uuid` del schema). NO
 * intenta ser exhaustiva: un scanner genérico que infiera el tipo de
 * cualquier columna requeriría resolver alias de tabla + join a
 * `schema.prisma`/SQL crudo de `ece.*`, lo cual es demasiado dinámico para
 * un test estático no-frágil (ver instrucciones del barrido). Columnas con
 * nombre ambiguo entre tablas (p.ej. `id`, `indicationId`, `firmaDir1Id`)
 * quedaron fuera de esta guarda a propósito — se verificaron manualmente
 * sitio por sitio en el PR, no aquí.
 *
 * Si este test falla: agregá `::uuid` inmediatamente después del
 * placeholder (`$1::uuid`), NUNCA remuevas la columna de la lista de abajo
 * para "arreglar" el test.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..");

// Columnas `@db.Uuid` en TODOS los modelos de schema.prisma donde aparecen
// (cero conflictos: ningún modelo las declara con otro tipo). Nombres tal
// como se citan en raw SQL contra tablas Prisma (`"camelCase"`).
const COLUMNAS_UUID_INEQUIVOCAS = [
  "organizationId",
  "patientId",
  "invoiceId",
  "patientAccountId",
  "costCenterId",
  "establishmentId",
  "encounterId",
  "userId",
  "ruleId",
  "drugId",
];

// Contexto de COMPARACIÓN (WHERE/AND/OR/ON), NUNCA de asignación (`SET col = $N`
// coerciona por assignment cast y está fuera de alcance — ver docstring). Exige
// que el keyword de comparación preceda a la columna en la misma línea.
function construirRegex(columna: string): RegExp {
  return new RegExp(`\\b(WHERE|AND|OR|ON)\\s+[\\w.]*"${columna}"\\s*=\\s*\\$\\d+(?!::)`, "i");
}

// establishment.router.ts:97 tiene su propia guarda dedicada en
// establishment.router.test.ts (fix puntual en PR #684, aún no mergeado a
// `main` al momento de este barrido — FIX-establishment-list-uuid). Excluido
// acá para no duplicar/competir con esa guarda mientras ambos PRs conviven.
const ARCHIVOS_EXCLUIDOS = [join("routers", "establishment.router.ts")];

function* archivosTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* archivosTs(full);
    else if (
      /\.ts$/.test(entry) &&
      !/\.test\.ts$/.test(entry) &&
      !ARCHIVOS_EXCLUIDOS.some((excluido) => full.endsWith(excluido))
    )
      yield full;
  }
}

describe("raw SQL — comparaciones uuid sin cast (regresión 42883)", () => {
  it("ninguna columna inequívocamente uuid se compara con $N sin ::uuid", () => {
    const ofensores: string[] = [];
    for (const file of archivosTs(SRC_ROOT)) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      for (const columna of COLUMNAS_UUID_INEQUIVOCAS) {
        const regex = construirRegex(columna);
        lines.forEach((linea, idx) => {
          if (regex.test(linea)) {
            ofensores.push(`${file}:${idx + 1} — "${columna}" = $N sin ::uuid`);
          }
        });
      }
    }
    expect(
      ofensores,
      `Comparaciones uuid=text sin cast (Postgres 42883):\n${ofensores.join("\n")}`,
    ).toEqual([]);
  });
});
