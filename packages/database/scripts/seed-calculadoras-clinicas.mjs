/**
 * Seed — Biblioteca inicial de calculadoras clínicas (CC-0009 / ECE-CALC-001).
 *
 * Siembra el catálogo `ece.calculadora` + su versión 1 en `ece.calculadora_version`
 * a partir de `data/calculadoras-catalog.json`.
 *
 * Gobernanza: TODA calculadora entra como `estado='borrador'` SIN versión publicada
 * (`version_actual_id = NULL`). No aparece en el widget del médico hasta que
 * Farmacia Clínica / Calidad agregue casos de prueba en verde + validación clínica
 * y publique (router `calculadoras.publicar`). El seed nunca publica.
 *
 * Idempotente: inserta-si-ausente por `codigo`. Si la calculadora ya existe NO se
 * toca (evita clobber de personalizaciones de país/pantalla o de versiones ya
 * publicadas por un admin). Para re-sembrar una entrada, bórrala antes.
 *
 * Requisito previo: SQL `185_calculadoras_clinicas.sql` aplicado (tablas + enums).
 *
 * Uso: node packages/database/scripts/seed-calculadoras-clinicas.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@his/database";

const prisma = new PrismaClient();
const here = dirname(fileURLToPath(import.meta.url));
const CATALOGO = join(here, "data", "calculadoras-catalog.json");

/**
 * Validación estructural mínima de la `def` (espejo de `validarDefinicion` del
 * router, sin importar el schema Zod de TS). No valida corrección clínica: eso
 * lo hace el gate de casos de prueba antes de publicar.
 * @returns {string | null} mensaje de error, o null si es válida.
 */
function validarDef(tipo, def) {
  if (!def || typeof def !== "object") return "def ausente";
  if (!def.out || typeof def.out !== "object") return "falta `out`";
  if (!Array.isArray(def.interp)) return "falta `interp`";
  if (tipo === "score") {
    if (!Array.isArray(def.items) || def.items.length === 0) return "score sin `items`";
  } else {
    if (!Array.isArray(def.inputs)) return "fórmula/dosis sin `inputs`";
    if (typeof def.expr !== "string" || !def.expr.trim()) return "fórmula/dosis sin `expr`";
  }
  return null;
}

async function seedOne(c) {
  const err = validarDef(c.tipo, c.def);
  if (err) {
    console.warn(`  SKIP  ${c.codigo}: ${err}`);
    return "skip";
  }

  const existe = await prisma.calculadora.findUnique({
    where: { codigo: c.codigo },
    select: { id: true },
  });
  if (existe) return "existe";

  await prisma.$transaction(async (tx) => {
    const calc = await tx.calculadora.create({
      data: {
        codigo: c.codigo,
        nombre: c.nombre,
        tipo: c.tipo,
        categoria: c.cat,
        altoRiesgo: Boolean(c.hr),
        sub: c.sub ?? null,
        ref: c.ref ?? null,
        estado: "borrador",
        paises: c.paises ?? {},
        paginas: c.paginas ?? "*",
      },
    });
    await tx.calculadoraVersion.create({
      data: { calculadoraId: calc.id, version: 1, definicion: c.def },
    });
  });
  return "creada";
}

async function main() {
  const catalogo = JSON.parse(readFileSync(CATALOGO, "utf8"));
  if (!Array.isArray(catalogo)) {
    throw new Error("El catálogo debe ser un arreglo JSON de calculadoras.");
  }
  console.log(`Sembrando ${catalogo.length} calculadoras clínicas (estado=borrador)…`);

  const tally = { creada: 0, existe: 0, skip: 0 };
  for (const c of catalogo) {
    const r = await seedOne(c);
    tally[r] += 1;
  }

  console.log(
    `Done. creadas=${tally.creada} · ya existían=${tally.existe} · omitidas=${tally.skip}`,
  );
  if (tally.skip > 0) {
    console.warn("⚠ Algunas entradas se omitieron por definición inválida (ver arriba).");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
