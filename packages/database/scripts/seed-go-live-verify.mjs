#!/usr/bin/env node
/**
 * Go-Live Verify — verificación post-seed (read-only).
 *
 * Comprueba:
 *   1. Conteo de filas en tablas críticas
 *   2. RLS habilitada en 5 tablas ECE clave
 *   3. Security advisors CRITICAL = 0 (vía Supabase Management API si disponible)
 *
 * Genera reporte JSON en ./go-live-readiness-{timestamp}.json
 *
 * Uso:
 *   node --env-file=.env packages/database/scripts/seed-go-live-verify.mjs
 *
 * Variables opcionales:
 *   SUPABASE_ACCESS_TOKEN  — para consultar advisors vía API
 *   SUPABASE_PROJECT_REF   — ref del proyecto (ej. ejacvsgbewcerxtjtwto)
 */

import { createRequire } from "module";
import { writeFileSync } from "fs";
import { join } from "path";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

// ─── Tablas a contar ─────────────────────────────────────────────────────────

const COUNT_TARGETS = [
  { label: "Organization",       sql: `SELECT COUNT(*) FROM public."Organization"` },
  { label: "Establishment",      sql: `SELECT COUNT(*) FROM public."Establishment"` },
  { label: "User",               sql: `SELECT COUNT(*) FROM public."User"` },
  { label: "Role",               sql: `SELECT COUNT(*) FROM public."Role"` },
  { label: "Permission",         sql: `SELECT COUNT(*) FROM public."Permission"` },
  { label: "RolePermission",     sql: `SELECT COUNT(*) FROM public."RolePermission"` },
  { label: "Icd10Catalog",       sql: `SELECT COUNT(*) FROM public."Icd10Catalog"` },
  { label: "Country",            sql: `SELECT COUNT(*) FROM public."Country"` },
  { label: "Currency",           sql: `SELECT COUNT(*) FROM public."Currency"` },
  { label: "ManchesterCategory", sql: `SELECT COUNT(*) FROM public."ManchesterCategory"` },
  {
    label: "ece.workflow_plantilla",
    sql: `SELECT COUNT(*) FROM ece.workflow_plantilla`,
    optional: true,   // tabla puede no existir si ECE no está migrada
  },
  {
    label: "ece.establecimiento",
    sql: `SELECT COUNT(*) FROM ece.establecimiento`,
    optional: true,
  },
  {
    label: "ece.personal_salud",
    sql: `SELECT COUNT(*) FROM ece.personal_salud`,
    optional: true,
  },
  {
    label: "audit.audit_log",
    sql: `SELECT COUNT(*) FROM audit.audit_log`,
    optional: true,
  },
];

// ─── Tablas ECE con RLS esperada ─────────────────────────────────────────────

const RLS_CHECK_TABLES = [
  { schema: "ece", table: "establecimiento" },
  { schema: "ece", table: "servicio"        },
  { schema: "ece", table: "cama"            },
  { schema: "ece", table: "personal_salud"  },
  { schema: "ece", table: "firma_electronica" },
];

// ─── Roles esperados (al menos estos deben existir) ──────────────────────────

const EXPECTED_ROLES = ["MC", "ENF", "FARM", "DIR", "ADMIN", "ADMIN_CLINICO", "WORKFLOW_DESIGNER", "PHYSICIAN", "NURSE", "PHARM"];

// ─── Plantillas workflow esperadas ───────────────────────────────────────────

const EXPECTED_PLANTILLAS = [
  "wf-hc-ambulatoria-primera",
  "wf-hc-ambulatoria-subsecuente",
  "wf-hospitalario-basico",
  "wf-cirugia-electiva",
  "wf-triage-manchester",
  "wf-consentimiento-ntec",
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL o DIRECT_URL requerida.");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  const report = {
    timestamp: new Date().toISOString(),
    overall: "PASS",
    issues: [],
    counts: {},
    rls: {},
    roles: {},
    workflow_plantillas: {},
    advisors: null,
  };

  try {
    await checkCounts(client, report);
    await checkRls(client, report);
    await checkRoles(client, report);
    await checkWorkflowPlantillas(client, report);
    await checkAdvisors(report);
  } finally {
    await client.end();
  }

  // Determinar overall
  if (report.issues.length > 0) {
    report.overall = "FAIL";
  }

  // Escribir JSON
  const filename = `go-live-readiness-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const outPath = join(process.cwd(), filename);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");

  // Imprimir resumen en consola
  printSummary(report, outPath);

  if (report.overall === "FAIL") {
    process.exit(1);
  }
}

// ─── Checks ──────────────────────────────────────────────────────────────────

async function checkCounts(client, report) {
  console.log("\n[1/4] Contando tablas críticas...");
  for (const target of COUNT_TARGETS) {
    try {
      const res = await client.query(target.sql);
      const count = parseInt(res.rows[0].count, 10);
      report.counts[target.label] = count;

      if (count === 0 && !target.optional) {
        const msg = `Tabla ${target.label} está vacía — seed no aplicado`;
        report.issues.push({ severity: "WARN", msg });
        console.log(`  WARN  ${target.label}: 0 filas`);
      } else {
        console.log(`  OK    ${target.label}: ${count} filas`);
      }
    } catch (err) {
      if (target.optional) {
        report.counts[target.label] = "N/A (tabla no existe)";
        console.log(`  SKIP  ${target.label}: tabla no existe (opcional)`);
      } else {
        const msg = `Error consultando ${target.label}: ${err.message}`;
        report.issues.push({ severity: "ERROR", msg });
        report.counts[target.label] = `ERROR: ${err.message}`;
        console.log(`  ERROR ${target.label}: ${err.message}`);
      }
    }
  }
}

async function checkRls(client, report) {
  console.log("\n[2/4] Verificando RLS en tablas ECE...");

  for (const t of RLS_CHECK_TABLES) {
    try {
      const res = await client.query(
        `SELECT relrowsecurity AS rls_enabled
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2`,
        [t.schema, t.table]
      );

      if (res.rows.length === 0) {
        report.rls[`${t.schema}.${t.table}`] = "NOT_FOUND";
        report.issues.push({ severity: "WARN", msg: `Tabla ${t.schema}.${t.table} no encontrada en pg_class` });
        console.log(`  SKIP  ${t.schema}.${t.table}: no encontrada`);
        continue;
      }

      const enabled = res.rows[0].rls_enabled;
      report.rls[`${t.schema}.${t.table}`] = enabled ? "ENABLED" : "DISABLED";

      if (!enabled) {
        const msg = `RLS deshabilitada en ${t.schema}.${t.table} — aplicar 65_ece_rls_hardening.sql`;
        report.issues.push({ severity: "ERROR", msg });
        console.log(`  FAIL  ${t.schema}.${t.table}: RLS deshabilitada`);
      } else {
        console.log(`  OK    ${t.schema}.${t.table}: RLS habilitada`);
      }
    } catch (err) {
      report.rls[`${t.schema}.${t.table}`] = `ERROR: ${err.message}`;
      report.issues.push({ severity: "ERROR", msg: `Error verificando RLS en ${t.schema}.${t.table}: ${err.message}` });
      console.log(`  ERROR ${t.schema}.${t.table}: ${err.message}`);
    }
  }
}

async function checkRoles(client, report) {
  console.log("\n[3/4] Verificando roles base...");

  try {
    const res = await client.query(
      `SELECT "code" FROM public."Role" WHERE "organizationId" IS NULL`
    );
    const existingCodes = new Set(res.rows.map((r) => r.code));

    for (const code of EXPECTED_ROLES) {
      const present = existingCodes.has(code);
      report.roles[code] = present ? "PRESENT" : "MISSING";
      if (!present) {
        report.issues.push({ severity: "ERROR", msg: `Rol ${code} no encontrado — ejecutar seed-go-live-defaults.mjs` });
        console.log(`  FAIL  Rol ${code}: FALTANTE`);
      } else {
        console.log(`  OK    Rol ${code}`);
      }
    }
  } catch (err) {
    report.issues.push({ severity: "ERROR", msg: `Error verificando roles: ${err.message}` });
    console.log(`  ERROR roles: ${err.message}`);
  }
}

async function checkWorkflowPlantillas(client, report) {
  console.log("\n[4/4] Verificando plantillas workflow ECE...");

  // Verificar que la tabla exista
  try {
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'ece' AND table_name = 'workflow_plantilla'
      ) AS exists
    `);

    if (!tableExists.rows[0]?.exists) {
      report.workflow_plantillas._status = "TABLA_NO_EXISTE";
      console.log("  SKIP  ece.workflow_plantilla: tabla no existe");
      return;
    }

    const res = await client.query(`SELECT codigo FROM ece.workflow_plantilla WHERE activo = true`);
    const existingCodes = new Set(res.rows.map((r) => r.codigo));

    for (const code of EXPECTED_PLANTILLAS) {
      const present = existingCodes.has(code);
      report.workflow_plantillas[code] = present ? "PRESENT" : "MISSING";
      if (!present) {
        report.issues.push({ severity: "WARN", msg: `Plantilla workflow ${code} no encontrada` });
        console.log(`  WARN  ${code}: FALTANTE`);
      } else {
        console.log(`  OK    ${code}`);
      }
    }
  } catch (err) {
    report.workflow_plantillas._error = err.message;
    report.issues.push({ severity: "WARN", msg: `Error verificando plantillas: ${err.message}` });
    console.log(`  ERROR plantillas: ${err.message}`);
  }
}

async function checkAdvisors(report) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref   = process.env.SUPABASE_PROJECT_REF;

  if (!token || !ref) {
    report.advisors = {
      status: "SKIPPED",
      reason: "SUPABASE_ACCESS_TOKEN o SUPABASE_PROJECT_REF no configurados",
    };
    console.log("\n[advisors] Saltado — SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_REF no configurados");
    return;
  }

  try {
    // Importación dinámica para no requerir fetch polyfill en Node < 18
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${ref}/advisors/security`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      report.advisors = { status: "ERROR", httpStatus: response.status };
      report.issues.push({ severity: "WARN", msg: `Supabase advisors API respondió ${response.status}` });
      return;
    }

    const data = await response.json();
    // La API retorna array de advisors; filtramos level CRITICAL
    const advisors = Array.isArray(data) ? data : (data.advisors ?? []);
    const criticals = advisors.filter((a) => (a.level ?? a.severity ?? "").toUpperCase() === "CRITICAL");

    report.advisors = {
      status: "OK",
      total:  advisors.length,
      critical: criticals.length,
      criticalItems: criticals.map((a) => ({
        title:       a.title ?? a.name ?? "unknown",
        description: a.description ?? "",
      })),
    };

    if (criticals.length > 0) {
      report.issues.push({
        severity: "ERROR",
        msg: `${criticals.length} advisor(s) CRITICAL en Supabase — resolver antes del go-live`,
      });
      console.log(`\n[advisors] FAIL: ${criticals.length} CRITICAL`);
      for (const c of criticals) {
        console.log(`  - ${c.title ?? c.name}`);
      }
    } else {
      console.log(`\n[advisors] OK: ${advisors.length} advisors, 0 CRITICAL`);
    }
  } catch (err) {
    report.advisors = { status: "ERROR", error: err.message };
    report.issues.push({ severity: "WARN", msg: `No se pudo consultar Supabase advisors: ${err.message}` });
    console.log(`\n[advisors] ERROR: ${err.message}`);
  }
}

// ─── Print summary ────────────────────────────────────────────────────────────

function printSummary(report, outPath) {
  console.log("\n═══════════════════════════════════════════");
  console.log(" GO-LIVE READINESS REPORT");
  console.log(`═══════════════════════════════════════════`);
  console.log(` Overall: ${report.overall}`);
  console.log(` Issues:  ${report.issues.length}`);

  if (report.issues.length > 0) {
    console.log("\n Problemas encontrados:");
    for (const issue of report.issues) {
      console.log(`  [${issue.severity}] ${issue.msg}`);
    }
  }

  console.log(`\n Reporte JSON: ${outPath}`);
  console.log("═══════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\nError fatal:", err.message);
  process.exit(1);
});
