/**
 * @his/database — Seed extendido SV (US-7.1, US-7.2 — equipo Echo).
 *
 * Idempotente: usa upsert por (countryId, code, level, validFrom) para
 * GeoDivision y por (countryId, geoDivisionId, date, name) para Holiday.
 *
 * Cubre:
 *  - 14 departamentos (defensivo: por si seed base no se corrió).
 *  - Lista representativa de los 44 municipios SV (post-reforma 2024 D.L.
 *    n.º 426 / 02-jun-2023). Esta seed contiene los principales 30+ municipios
 *    consolidados; el listado oficial completo de 44 sigue siendo iterativo
 *    (algunos cabeceras cambiaron). TODO confirmado más abajo.
 *  - Feriados nacionales SV 2026 (TDR §27.4) — Pascua hardcodeada.
 *
 * Ejecutar:  npm run -w @his/database seed:sv-extra
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** validFrom de la reforma territorial 2024 SV (D.L. n.º 426 efectivo). */
const VALID_FROM_REFORMA = new Date("2024-05-01T00:00:00Z");
/** validFrom histórico de los 14 departamentos (TDR §27.4). */
const VALID_FROM_DEPTOS = new Date("2019-01-01T00:00:00Z");

/** 14 departamentos SV con código MINSAL/RNPN. */
const DEPARTAMENTOS: Array<{ code: string; name: string }> = [
  { code: "01", name: "Ahuachapán" },
  { code: "02", name: "Santa Ana" },
  { code: "03", name: "Sonsonate" },
  { code: "04", name: "Chalatenango" },
  { code: "05", name: "La Libertad" },
  { code: "06", name: "San Salvador" },
  { code: "07", name: "Cuscatlán" },
  { code: "08", name: "La Paz" },
  { code: "09", name: "Cabañas" },
  { code: "10", name: "San Vicente" },
  { code: "11", name: "Usulután" },
  { code: "12", name: "San Miguel" },
  { code: "13", name: "Morazán" },
  { code: "14", name: "La Unión" },
];

/**
 * Municipios SV — Reforma Territorial 2024 (D.L. n.º 426).
 * Esquema: 44 municipios consolidados a partir de los 262 históricos.
 *
 * NOTA: el listado oficial publicado por el TSE/Asamblea Legislativa contempla
 * 44 municipios distribuidos típicamente en bloques "Norte/Centro/Este/Oeste"
 * por departamento. La seed registra los nombres y "departamento padre" en
 * formato `{ deptoCode, code, name }`. El `code` es el correlativo dentro
 * del depto (`DD-NN`).
 *
 * TODO: completar lista oficial 44 municipios reforma 2024 — algunos cabeceras
 * se reasignaron (e.g. La Libertad Costa vs La Libertad Centro). Se mantienen
 * los nombres más usados públicamente; revisar contra fuente oficial al
 * cerrar Sprint.
 */
const MUNICIPIOS: Array<{ deptoCode: string; code: string; name: string }> = [
  // Ahuachapán (01) — 3 municipios consolidados
  { deptoCode: "01", code: "01-01", name: "Ahuachapán Norte" },
  { deptoCode: "01", code: "01-02", name: "Ahuachapán Centro" },
  { deptoCode: "01", code: "01-03", name: "Ahuachapán Sur" },
  // Santa Ana (02) — 3 municipios
  { deptoCode: "02", code: "02-01", name: "Santa Ana Norte" },
  { deptoCode: "02", code: "02-02", name: "Santa Ana Centro" },
  { deptoCode: "02", code: "02-03", name: "Santa Ana Este" },
  // Sonsonate (03) — 4 municipios
  { deptoCode: "03", code: "03-01", name: "Sonsonate Norte" },
  { deptoCode: "03", code: "03-02", name: "Sonsonate Centro" },
  { deptoCode: "03", code: "03-03", name: "Sonsonate Este" },
  { deptoCode: "03", code: "03-04", name: "Sonsonate Oeste" },
  // Chalatenango (04) — 3 municipios
  { deptoCode: "04", code: "04-01", name: "Chalatenango Norte" },
  { deptoCode: "04", code: "04-02", name: "Chalatenango Centro" },
  { deptoCode: "04", code: "04-03", name: "Chalatenango Sur" },
  // La Libertad (05) — 6 municipios
  { deptoCode: "05", code: "05-01", name: "La Libertad Norte" },
  { deptoCode: "05", code: "05-02", name: "La Libertad Centro" },
  { deptoCode: "05", code: "05-03", name: "La Libertad Oeste" },
  { deptoCode: "05", code: "05-04", name: "La Libertad Este" },
  { deptoCode: "05", code: "05-05", name: "La Libertad Costa" },
  { deptoCode: "05", code: "05-06", name: "La Libertad Sur" },
  // San Salvador (06) — 5 municipios
  { deptoCode: "06", code: "06-01", name: "San Salvador Norte" },
  { deptoCode: "06", code: "06-02", name: "San Salvador Centro" },
  { deptoCode: "06", code: "06-03", name: "San Salvador Oeste" },
  { deptoCode: "06", code: "06-04", name: "San Salvador Este" },
  { deptoCode: "06", code: "06-05", name: "San Salvador Sur" },
  // Cuscatlán (07) — 2 municipios
  { deptoCode: "07", code: "07-01", name: "Cuscatlán Norte" },
  { deptoCode: "07", code: "07-02", name: "Cuscatlán Sur" },
  // La Paz (08) — 3 municipios
  { deptoCode: "08", code: "08-01", name: "La Paz Oeste" },
  { deptoCode: "08", code: "08-02", name: "La Paz Centro" },
  { deptoCode: "08", code: "08-03", name: "La Paz Este" },
  // Cabañas (09) — 2 municipios
  { deptoCode: "09", code: "09-01", name: "Cabañas Oeste" },
  { deptoCode: "09", code: "09-02", name: "Cabañas Este" },
  // San Vicente (10) — 2 municipios
  { deptoCode: "10", code: "10-01", name: "San Vicente Norte" },
  { deptoCode: "10", code: "10-02", name: "San Vicente Sur" },
  // Usulután (11) — 3 municipios
  { deptoCode: "11", code: "11-01", name: "Usulután Norte" },
  { deptoCode: "11", code: "11-02", name: "Usulután Este" },
  { deptoCode: "11", code: "11-03", name: "Usulután Oeste" },
  // San Miguel (12) — 3 municipios
  { deptoCode: "12", code: "12-01", name: "San Miguel Norte" },
  { deptoCode: "12", code: "12-02", name: "San Miguel Centro" },
  { deptoCode: "12", code: "12-03", name: "San Miguel Oeste" },
  // Morazán (13) — 2 municipios
  { deptoCode: "13", code: "13-01", name: "Morazán Norte" },
  { deptoCode: "13", code: "13-02", name: "Morazán Sur" },
  // La Unión (14) — 2 municipios
  { deptoCode: "14", code: "14-01", name: "La Unión Norte" },
  { deptoCode: "14", code: "14-02", name: "La Unión Sur" },
];

/**
 * Feriados nacionales SV 2026 — TDR §27.4.
 * Pascua: 5-abr-2026 (Domingo Resurrección); por tanto Jueves/Viernes/Sábado
 * Santo = 2/3/4 abr 2026. Hardcodeado: no usamos lib de cálculo Computus en
 * MVP (sería sobre-ingeniería para 1 país). Si en futuro agregamos Guatemala
 * u Honduras se evaluará introducir `easter-date` o similar.
 */
const HOLIDAYS_SV_2026: Array<{ date: string; name: string; kind: string }> = [
  { date: "2026-01-01", name: "Año Nuevo", kind: "NATIONAL" },
  { date: "2026-04-02", name: "Jueves Santo", kind: "RELIGIOUS" },
  { date: "2026-04-03", name: "Viernes Santo", kind: "RELIGIOUS" },
  { date: "2026-04-04", name: "Sábado Santo", kind: "RELIGIOUS" },
  { date: "2026-05-01", name: "Día Internacional del Trabajo", kind: "NATIONAL" },
  { date: "2026-05-10", name: "Día de la Madre", kind: "NATIONAL" },
  { date: "2026-06-17", name: "Día del Padre", kind: "NATIONAL" },
  { date: "2026-08-01", name: "Vacaciones Agostinas — Inicio", kind: "NATIONAL" },
  { date: "2026-08-06", name: "Día del Salvador del Mundo", kind: "RELIGIOUS" },
  { date: "2026-09-15", name: "Día de la Independencia", kind: "NATIONAL" },
  { date: "2026-11-02", name: "Día de los Difuntos", kind: "RELIGIOUS" },
  { date: "2026-12-25", name: "Navidad", kind: "RELIGIOUS" },
];

async function main() {
  console.log("[seed-sv-extra] Inicio");

  // 1. País SV (idempotente)
  const country = await prisma.country.upsert({
    where: { isoAlpha3: "SLV" },
    update: {},
    create: {
      isoAlpha3: "SLV",
      isoNumeric: 222,
      name: "El Salvador",
      defaultLocale: "es-SV",
      defaultTzId: "America/El_Salvador",
    },
  });

  // 2. Departamentos (defensivo)
  const deptoByCode = new Map<string, string>();
  for (const d of DEPARTAMENTOS) {
    const row = await prisma.geoDivision.upsert({
      where: {
        countryId_code_level_validFrom: {
          countryId: country.id,
          code: d.code,
          level: 1,
          validFrom: VALID_FROM_DEPTOS,
        },
      },
      update: {},
      create: {
        countryId: country.id,
        level: 1,
        code: d.code,
        name: d.name,
        validFrom: VALID_FROM_DEPTOS,
      },
    });
    deptoByCode.set(d.code, row.id);
  }
  console.log(`[seed-sv-extra] Departamentos: ${DEPARTAMENTOS.length}`);

  // 3. Municipios (reforma 2024)
  let muniCount = 0;
  for (const m of MUNICIPIOS) {
    const parentId = deptoByCode.get(m.deptoCode);
    if (!parentId) {
      console.warn(`[seed-sv-extra] Sin depto padre para ${m.code} (${m.deptoCode})`);
      continue;
    }
    await prisma.geoDivision.upsert({
      where: {
        countryId_code_level_validFrom: {
          countryId: country.id,
          code: m.code,
          level: 2,
          validFrom: VALID_FROM_REFORMA,
        },
      },
      update: { name: m.name, parentId },
      create: {
        countryId: country.id,
        parentId,
        level: 2,
        code: m.code,
        name: m.name,
        validFrom: VALID_FROM_REFORMA,
      },
    });
    muniCount += 1;
  }
  console.log(`[seed-sv-extra] Municipios: ${muniCount}`);

  // 4. Feriados 2026 — geoDivisionId es null para nacionales, lo cual rompe
  // el compound unique de Prisma `upsert`. Usamos findFirst + create/update
  // para mantener idempotencia.
  let holCount = 0;
  for (const h of HOLIDAYS_SV_2026) {
    const date = new Date(h.date);
    const existing = await prisma.holiday.findFirst({
      where: {
        countryId: country.id,
        geoDivisionId: null,
        date,
        name: h.name,
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.holiday.update({
        where: { id: existing.id },
        data: { kind: h.kind },
      });
    } else {
      await prisma.holiday.create({
        data: {
          countryId: country.id,
          date,
          name: h.name,
          kind: h.kind,
          recurring: false,
        },
      });
    }
    holCount += 1;
  }
  console.log(`[seed-sv-extra] Holidays SV 2026: ${holCount}`);
  console.log("[seed-sv-extra] OK");
}

main()
  .catch((e) => {
    console.error("[seed-sv-extra] ERROR", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
