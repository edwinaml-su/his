#!/usr/bin/env node
/**
 * seed-uat-patients.mjs
 *
 * Siembra 100 pacientes de prueba UAT con identificación distintiva
 * (`firstName = 'UAT'`, `lastName = 'Test Paciente NNN'`, MRN `UAT-2026-NNN`)
 * para que el operador pueda probar el flujo end-to-end del Portal del
 * Paciente y borrarlos en bloque con `cleanup-uat-patients.mjs`.
 *
 * Genera:
 *   - 100 pacientes con DUI válido (checksum verificado), sexo y fecha
 *     de nacimiento aleatorios, GeoId NULL.
 *   - 100 PatientIdentifier kind=DUI vinculados.
 *   - 25 pacientes con Encounter (tipo OUTPATIENT) + TriageEvaluation
 *     COMPLETED en niveles realistas (1 RED, 4 ORANGE, 8 YELLOW, 8 GREEN,
 *     4 BLUE — distribución típica de un día de emergencia).
 *   - Si no existe TriageFlowchart para la organización, crea uno básico
 *     "MANCHESTER-ADULT" para que el seed funcione standalone.
 *
 * Idempotente: SELECT-then-INSERT por MRN. Re-corridas no duplican datos.
 *
 * Requisitos de entorno (.env en packages/database/):
 *   DIRECT_URL — conexión directa Postgres (sin pooler). Obligatorio.
 *
 * NO ejecutar en producción salvo coordinado con el operador.
 * Los DUIs son ficticios pero válidos por checksum (NO corresponden a
 * personas reales — usan cuerpos 90000001..90000100 reservados).
 *
 * Uso:
 *   node --env-file=.env scripts/seed-uat-patients.mjs
 *   npm run -w @his/database seed:uat
 *
 * Para limpiar después del UAT:
 *   node --env-file=.env scripts/cleanup-uat-patients.mjs
 */

import pg from "pg";

// ─────────────────────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────────────────────
const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) {
  console.error("ERROR: DIRECT_URL no definida. Agrega la variable al .env.");
  process.exit(2);
}

const TOTAL_PATIENTS = 100;
const PATIENTS_WITH_TRIAGE = 25;
const UAT_FIRST_NAME = "UAT";
const UAT_LAST_NAME_PREFIX = "Test Paciente";
const UAT_MRN_PREFIX = "UAT-2026-";
// Cuerpos DUI 90000001..90000100 — rango reservado para UAT.
const DUI_BODY_BASE = 90000001;

// Distribución realista Manchester (por prioridad 1=RED → 5=BLUE).
const TRIAGE_DISTRIBUTION = [
  { priority: 1, count: 1 },   // RED
  { priority: 2, count: 4 },   // ORANGE
  { priority: 3, count: 8 },   // YELLOW
  { priority: 4, count: 8 },   // GREEN
  { priority: 5, count: 4 },   // BLUE
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Cálculo del dígito verificador DUI (módulo 10 con pesos 9..2). */
function duiCheckDigit(body8) {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number.parseInt(body8.charAt(i), 10) * (10 - (i + 1));
  }
  let calc = 10 - (sum % 10);
  if (calc === 10) calc = 0;
  return calc;
}

function makeValidDui(body8) {
  return `${body8}${duiCheckDigit(body8)}`;
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

function randomBirthDate(minAge, maxAge) {
  const now = new Date();
  const ageYears = minAge + Math.floor(Math.random() * (maxAge - minAge));
  const year = now.getFullYear() - ageYears;
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function step(msg) {
  process.stdout.write(`  → ${msg} ... `);
}
function ok(detail = "") {
  console.log(`OK${detail ? " " + detail : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Conexión
// ─────────────────────────────────────────────────────────────────────────────
const cleanUrl = DIRECT_URL
  .replace(/[?&]sslmode=[^&]*/g, "")
  .replace("?&", "?")
  .replace(/[?&]$/, "");

const client = new pg.Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(70));
  console.log(`Seed UAT: ${TOTAL_PATIENTS} pacientes (${PATIENTS_WITH_TRIAGE} con triage)`);
  console.log("=".repeat(70));

  await client.connect();

  // ── 1. Detectar tenant (organization + establishment) ────────────────────
  step("Detectar tenant activo (primer Establishment)");
  const { rows: [tenant] } = await client.query(`
    SELECT e.id AS estab_id,
           e."organizationId" AS org_id,
           o."countryId" AS country_id,
           cur.id AS currency_id
    FROM public."Establishment" e
    JOIN public."Organization" o ON o.id = e."organizationId"
    JOIN public."Currency" cur ON cur."isoCode" = 'USD'
    WHERE e.active = true
    LIMIT 1
  `);
  if (!tenant) throw new Error("Sin Establishment activo + Currency USD. Ejecuta seed base primero.");
  ok(`org=${tenant.org_id.slice(0, 8)} estab=${tenant.estab_id.slice(0, 8)}`);

  // ── 2. Catálogos: sexos, triage levels, identifier DUI ───────────────────
  step("Cargar catálogos (sexos, triage levels, identifier DUI)");
  const { rows: sexes } = await client.query(`
    SELECT id, code FROM public."BiologicalSex" WHERE active = true
  `);
  const sexByCode = Object.fromEntries(sexes.map((s) => [s.code, s.id]));
  if (!sexByCode.M || !sexByCode.F) throw new Error("Faltan BiologicalSex M/F.");

  const { rows: levels } = await client.query(`
    SELECT id, color, priority FROM public."TriageLevel"
    WHERE ("organizationId" = $1 OR "organizationId" IS NULL) AND active = true
    ORDER BY priority
  `, [tenant.org_id]);
  if (levels.length === 0) throw new Error("Sin TriageLevel. Ejecuta seed base.");
  const levelByPriority = Object.fromEntries(levels.map((l) => [l.priority, l.id]));

  const { rows: [duiType] } = await client.query(`
    SELECT id FROM public."IdentifierType" WHERE code = 'DUI' AND active = true LIMIT 1
  `);
  if (!duiType) throw new Error("Sin IdentifierType DUI. Ejecuta seed base.");
  ok();

  // ── 3. Asegurar TriageFlowchart MANCHESTER ────────────────────────────────
  step("TriageFlowchart MANCHESTER-ADULT");
  let flowchartId;
  const { rows: [existFc] } = await client.query(`
    SELECT id FROM public."TriageFlowchart"
    WHERE "organizationId" = $1 AND code = 'MANCHESTER-ADULT'
    LIMIT 1
  `, [tenant.org_id]);
  if (existFc) {
    flowchartId = existFc.id;
    ok(`existente ${flowchartId.slice(0, 8)}`);
  } else {
    const { rows: [newFc] } = await client.query(`
      INSERT INTO public."TriageFlowchart"
        (id, "organizationId", code, name, "isPediatric", "defaultLevelId",
         active, "validFrom", version, "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), $1, 'MANCHESTER-ADULT', 'Manchester Adulto (UAT)',
         false, $2, true, now(), 1, now(), now())
      RETURNING id
    `, [tenant.org_id, levelByPriority[4]]);
    flowchartId = newFc.id;
    ok(`creado ${flowchartId.slice(0, 8)}`);
  }

  // ── 4. Sembrar 100 pacientes ─────────────────────────────────────────────
  step(`${TOTAL_PATIENTS} pacientes UAT`);
  let created = 0;
  let existed = 0;
  const patientRows = [];
  for (let i = 0; i < TOTAL_PATIENTS; i++) {
    const idx = i + 1;
    const mrn = `${UAT_MRN_PREFIX}${pad3(idx)}`;
    const lastName = `${UAT_LAST_NAME_PREFIX} ${pad3(idx)}`;
    const duiBody = String(DUI_BODY_BASE + i).padStart(8, "0");
    const dui = makeValidDui(duiBody);
    const sexCode = i % 2 === 0 ? "M" : "F";
    const birthDate = randomBirthDate(18, 80);

    // SELECT-then-INSERT por MRN para idempotencia.
    const { rows: [exist] } = await client.query(`
      SELECT id FROM public."Patient"
      WHERE "organizationId" = $1 AND mrn = $2 LIMIT 1
    `, [tenant.org_id, mrn]);

    let patientId;
    if (exist) {
      patientId = exist.id;
      existed++;
    } else {
      const { rows: [newPat] } = await client.query(`
        INSERT INTO public."Patient"
          (id, "organizationId", mrn, "firstName", "lastName",
           "biologicalSexId", "birthDate", "birthDateEstimated",
           "isUnknown", active, "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid(), $1, $2, $3, $4, $5, $6::date, false, false, true, now(), now())
        RETURNING id
      `, [tenant.org_id, mrn, UAT_FIRST_NAME, lastName, sexByCode[sexCode], birthDate]);
      patientId = newPat.id;
      created++;

      // PatientIdentifier kind=DUI.
      await client.query(`
        INSERT INTO public."PatientIdentifier"
          (id, "patientId", "typeId", value, "validFrom", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), $1, $2, $3, now(), now(), now())
        ON CONFLICT DO NOTHING
      `, [patientId, duiType.id, duiBody + String(duiCheckDigit(duiBody))]);
    }

    patientRows.push({ id: patientId, mrn, sexCode, dui });
  }
  ok(`creados=${created} existentes=${existed}`);

  // ── 5. Sembrar Encounters + Triage para 25 pacientes ─────────────────────
  step(`${PATIENTS_WITH_TRIAGE} encounters + triage (distribución Manchester)`);
  const triagePlan = [];
  for (const tier of TRIAGE_DISTRIBUTION) {
    for (let j = 0; j < tier.count; j++) {
      triagePlan.push(tier.priority);
    }
  }
  // triagePlan ahora tiene exactamente 25 entradas (1+4+8+8+4).

  let triageCreated = 0;
  let triageSkipped = 0;
  for (let i = 0; i < triagePlan.length; i++) {
    const patient = patientRows[i];
    const priority = triagePlan[i];
    const encounterNumber = `UAT-EMG-${pad3(i + 1)}`;

    // Skip si ya existe encounter UAT para este paciente.
    const { rows: [existEnc] } = await client.query(`
      SELECT id FROM public."Encounter"
      WHERE "patientId" = $1 AND "encounterNumber" = $2 LIMIT 1
    `, [patient.id, encounterNumber]);
    if (existEnc) {
      triageSkipped++;
      continue;
    }

    const admittedAt = new Date(Date.now() - (24 - i) * 60 * 60 * 1000); // últimas 24h
    const { rows: [enc] } = await client.query(`
      INSERT INTO public."Encounter"
        (id, "countryId", "organizationId", "establishmentId", "patientId",
         "admissionType", "encounterNumber", "admittedAt", "currencyId",
         "exchangeRateToFunc", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), $1, $2, $3, $4,
         'EMERGENCY', $5, $6::timestamptz, $7,
         1.0, now(), now())
      RETURNING id
    `, [tenant.country_id, tenant.org_id, tenant.estab_id, patient.id,
        encounterNumber, admittedAt.toISOString(), tenant.currency_id]);

    const completedAt = new Date(admittedAt.getTime() + 15 * 60 * 1000); // 15 min después
    await client.query(`
      INSERT INTO public."TriageEvaluation"
        (id, "countryId", "organizationId", "establishmentId", "patientId",
         "encounterId", "flowchartId", "assignedLevelId",
         status, "startedAt", "completedAt", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), $1, $2, $3, $4,
         $5, $6, $7,
         'COMPLETED', $8::timestamptz, $9::timestamptz, now(), now())
    `, [tenant.country_id, tenant.org_id, tenant.estab_id, patient.id,
        enc.id, flowchartId, levelByPriority[priority],
        admittedAt.toISOString(), completedAt.toISOString()]);

    triageCreated++;
  }
  ok(`creados=${triageCreated} omitidos=${triageSkipped}`);

  // ── 6. Resumen ───────────────────────────────────────────────────────────
  console.log("");
  console.log("=".repeat(70));
  console.log("RESUMEN");
  console.log("=".repeat(70));
  console.log(`Pacientes UAT          : ${TOTAL_PATIENTS}`);
  console.log(`  Creados              : ${created}`);
  console.log(`  Ya existían          : ${existed}`);
  console.log(`Encounters + Triage    : ${PATIENTS_WITH_TRIAGE} pacientes`);
  console.log(`  Creados              : ${triageCreated}`);
  console.log(`  Ya existían          : ${triageSkipped}`);
  console.log("");
  console.log("Identificación de los datos (para cleanup):");
  console.log(`  firstName = 'UAT'`);
  console.log(`  mrn LIKE  '${UAT_MRN_PREFIX}%'`);
  console.log(`  encounterNumber LIKE 'UAT-EMG-%'`);
  console.log("");
  console.log("Distribución Manchester aplicada:");
  for (const t of TRIAGE_DISTRIBUTION) {
    const color = levels.find((l) => l.priority === t.priority)?.color;
    console.log(`  P${t.priority} (${color}): ${t.count}`);
  }
  console.log("");
  console.log("DUIs ficticios usados (rango UAT, NO corresponden a personas reales):");
  console.log(`  ${patientRows[0].dui} … ${patientRows[TOTAL_PATIENTS - 1].dui}`);
  console.log("");
  console.log("Para usar en Portal Paciente (/portal/register):");
  console.log(`  DUI: ${patientRows[0].dui}`);
  console.log(`  MRN: ${patientRows[0].mrn}`);
  console.log(`  Email: cualquier correo del operador UAT`);
  console.log("");
  console.log("Cleanup:");
  console.log("  node --env-file=.env scripts/cleanup-uat-patients.mjs");
}

main()
  .catch((e) => {
    console.error("");
    console.error("FALLÓ:", e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  })
  .finally(() => client.end());
