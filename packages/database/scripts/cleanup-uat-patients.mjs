#!/usr/bin/env node
/**
 * cleanup-uat-patients.mjs
 *
 * Borra TODOS los datos UAT sembrados por `seed-uat-patients.mjs`.
 * Identifica los registros por:
 *   - Patient.firstName = 'UAT' AND mrn LIKE 'UAT-2026-%'
 *   - Encounter.encounterNumber LIKE 'UAT-EMG-%'
 *
 * Orden de borrado (respeta foreign keys):
 *   1. PortalMagicLink   ← por accountId del paciente UAT
 *   2. PortalSession     ← idem
 *   3. PortalAccount     ← cuentas portal del UAT
 *   4. TriageEvaluation  ← por patientId UAT
 *   5. Encounter         ← por patientId UAT y encounterNumber UAT-EMG-*
 *   6. PatientIdentifier ← por patientId UAT
 *   7. Patient           ← finalmente
 *
 * Usa --dry-run para ver qué se borraría sin tocar la BD:
 *   node --env-file=.env scripts/cleanup-uat-patients.mjs --dry-run
 *
 * Sin --confirm pide confirmación interactiva en TTY (sólo si la salida
 * va a una terminal). En CI/script automático usa --confirm explícito.
 *
 * Uso:
 *   node --env-file=.env scripts/cleanup-uat-patients.mjs [--dry-run] [--confirm]
 *   npm run -w @his/database seed:uat:clean
 */

import pg from "pg";
import readline from "node:readline";

// ─────────────────────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────────────────────
const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) {
  console.error("ERROR: DIRECT_URL no definida.");
  process.exit(2);
}

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const CONFIRMED = args.has("--confirm");

const cleanUrl = DIRECT_URL
  .replace(/[?&]sslmode=[^&]*/g, "")
  .replace("?&", "?")
  .replace(/[?&]$/, "");

const client = new pg.Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

function step(msg) {
  process.stdout.write(`  → ${msg} ... `);
}
function ok(detail = "") {
  console.log(`OK${detail ? " " + detail : ""}`);
}

async function askConfirm() {
  if (CONFIRMED) return true;
  if (!process.stdin.isTTY) {
    console.error("Sin TTY y sin --confirm. Aborta por seguridad.");
    process.exit(3);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("¿Confirmas el borrado? (escribe BORRAR): ", (answer) => {
      rl.close();
      resolve(answer.trim() === "BORRAR");
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(70));
  console.log("Cleanup UAT Patients" + (DRY_RUN ? " (DRY RUN)" : ""));
  console.log("=".repeat(70));

  await client.connect();

  // ── 1. Contar registros candidatos ───────────────────────────────────────
  step("Identificar pacientes UAT");
  const { rows: [patientCount] } = await client.query(`
    SELECT count(*)::int AS n
    FROM public."Patient"
    WHERE "firstName" = 'UAT' AND mrn LIKE 'UAT-2026-%'
  `);
  ok(`${patientCount.n} pacientes`);

  if (patientCount.n === 0) {
    console.log("\nNada que limpiar. Salida sin cambios.");
    return;
  }

  // Tabla de previsualización
  const { rows: preview } = await client.query(`
    SELECT mrn, "firstName", "lastName"
    FROM public."Patient"
    WHERE "firstName" = 'UAT' AND mrn LIKE 'UAT-2026-%'
    ORDER BY mrn
    LIMIT 5
  `);
  console.log("");
  console.log("Muestra de pacientes a eliminar (primeros 5):");
  for (const p of preview) {
    console.log(`  ${p.mrn}  ${p.firstName} ${p.lastName}`);
  }
  if (patientCount.n > 5) console.log(`  ... y ${patientCount.n - 5} más`);
  console.log("");

  if (DRY_RUN) {
    // Resumen sin tocar la BD.
    const counts = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public."Encounter"
         WHERE "encounterNumber" LIKE 'UAT-EMG-%') AS encounters,
        (SELECT count(*)::int FROM public."TriageEvaluation"
         WHERE "patientId" IN (
           SELECT id FROM public."Patient"
           WHERE "firstName" = 'UAT' AND mrn LIKE 'UAT-2026-%'
         )) AS triages,
        (SELECT count(*)::int FROM public."PatientIdentifier"
         WHERE "patientId" IN (
           SELECT id FROM public."Patient"
           WHERE "firstName" = 'UAT' AND mrn LIKE 'UAT-2026-%'
         )) AS identifiers,
        (SELECT count(*)::int FROM public."PortalAccount"
         WHERE "patientId" IN (
           SELECT id FROM public."Patient"
           WHERE "firstName" = 'UAT' AND mrn LIKE 'UAT-2026-%'
         )) AS portal_accounts
    `);
    console.log("Se eliminarían:");
    console.log(`  Patient            : ${patientCount.n}`);
    console.log(`  PatientIdentifier  : ${counts.rows[0].identifiers}`);
    console.log(`  Encounter          : ${counts.rows[0].encounters}`);
    console.log(`  TriageEvaluation   : ${counts.rows[0].triages}`);
    console.log(`  PortalAccount      : ${counts.rows[0].portal_accounts}`);
    console.log("");
    console.log("DRY RUN — sin cambios aplicados. Quita --dry-run para borrar.");
    return;
  }

  const confirmed = await askConfirm();
  if (!confirmed) {
    console.log("Cancelado por el operador.");
    return;
  }

  // ── 2. Borrado en transacción ────────────────────────────────────────────
  await client.query("BEGIN");
  try {
    step("PortalMagicLink");
    const r1 = await client.query(`
      DELETE FROM public."PortalMagicLink"
      WHERE "accountId" IN (
        SELECT pa.id FROM public."PortalAccount" pa
        JOIN public."Patient" p ON p.id = pa."patientId"
        WHERE p."firstName" = 'UAT' AND p.mrn LIKE 'UAT-2026-%'
      )
    `);
    ok(`${r1.rowCount} filas`);

    step("PortalSession");
    const r2 = await client.query(`
      DELETE FROM public."PortalSession"
      WHERE "accountId" IN (
        SELECT pa.id FROM public."PortalAccount" pa
        JOIN public."Patient" p ON p.id = pa."patientId"
        WHERE p."firstName" = 'UAT' AND p.mrn LIKE 'UAT-2026-%'
      )
    `);
    ok(`${r2.rowCount} filas`);

    step("PortalAccount");
    const r3 = await client.query(`
      DELETE FROM public."PortalAccount"
      WHERE "patientId" IN (
        SELECT id FROM public."Patient"
        WHERE "firstName" = 'UAT' AND mrn LIKE 'UAT-2026-%'
      )
    `);
    ok(`${r3.rowCount} filas`);

    step("TriageEvaluation");
    const r4 = await client.query(`
      DELETE FROM public."TriageEvaluation"
      WHERE "patientId" IN (
        SELECT id FROM public."Patient"
        WHERE "firstName" = 'UAT' AND mrn LIKE 'UAT-2026-%'
      )
    `);
    ok(`${r4.rowCount} filas`);

    step("Encounter (UAT-EMG-*)");
    const r5 = await client.query(`
      DELETE FROM public."Encounter"
      WHERE "encounterNumber" LIKE 'UAT-EMG-%'
        AND "patientId" IN (
          SELECT id FROM public."Patient"
          WHERE "firstName" = 'UAT' AND mrn LIKE 'UAT-2026-%'
        )
    `);
    ok(`${r5.rowCount} filas`);

    step("PatientIdentifier");
    const r6 = await client.query(`
      DELETE FROM public."PatientIdentifier"
      WHERE "patientId" IN (
        SELECT id FROM public."Patient"
        WHERE "firstName" = 'UAT' AND mrn LIKE 'UAT-2026-%'
      )
    `);
    ok(`${r6.rowCount} filas`);

    step("Patient");
    const r7 = await client.query(`
      DELETE FROM public."Patient"
      WHERE "firstName" = 'UAT' AND mrn LIKE 'UAT-2026-%'
    `);
    ok(`${r7.rowCount} filas`);

    await client.query("COMMIT");
    console.log("\nCleanup completado.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

main()
  .catch((e) => {
    console.error("");
    console.error("FALLÓ:", e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  })
  .finally(() => client.end());
