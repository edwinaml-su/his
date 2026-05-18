#!/usr/bin/env node
/**
 * scripts/check-supabase-advisors.mjs
 *
 * Cron semanal: consulta Supabase Management API para obtener los advisors
 * del proyecto HIS y emite un reporte JSON parseable al stdout.
 *
 * Exit codes:
 *   0 — sin warnings ni errores (o solo INFO)
 *   1 — hay advisors de nivel WARN
 *   2 — hay advisors de nivel ERROR / CRITICAL
 *
 * Uso:
 *   SUPABASE_ACCESS_TOKEN=<pat> SUPABASE_PROJECT_REF=<ref> node scripts/check-supabase-advisors.mjs
 *
 * En GitHub Actions (cron semanal):
 *   - Configurar los secrets SUPABASE_ACCESS_TOKEN y SUPABASE_PROJECT_REF.
 *   - El script sale con código != 0 si hay CRITICAL > 0, lo que falla el job
 *     y genera una alerta en la UI de Actions / Slack si hay webhook configurado.
 *
 * Salida (stdout, JSON):
 *   {
 *     "checkedAt": "2026-05-18T10:00:00.000Z",
 *     "projectRef": "ejacvsgbewcerxtjtwto",
 *     "summary": { "CRITICAL": 0, "WARN": 2, "INFO": 5 },
 *     "advisors": [ { "name": "...", "level": "WARN", "description": "..." } ]
 *   }
 *
 * Cero dependencias externas — solo Node.js 18+ (fetch nativo).
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'ejacvsgbewcerxtjtwto';
const API_BASE = 'https://api.supabase.com';
const TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Colores para stderr (no contaminan el JSON en stdout)
// ---------------------------------------------------------------------------
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(msg) {
  process.stderr.write(msg + '\n');
}

function badge(level) {
  switch (level) {
    case 'CRITICAL':
    case 'ERROR':
      return `${c.bold}${c.red}[${level}]${c.reset}`;
    case 'WARN':
      return `${c.bold}${c.yellow}[WARN]${c.reset}`;
    default:
      return `${c.dim}[${level}]${c.reset}`;
  }
}

// ---------------------------------------------------------------------------
// Validación de env
// ---------------------------------------------------------------------------
if (!ACCESS_TOKEN) {
  log(`${c.red}ERROR: SUPABASE_ACCESS_TOKEN no está definido.${c.reset}`);
  log('Ejecuta: export SUPABASE_ACCESS_TOKEN=<tu-token>');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Fetch con timeout
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Obtener advisors
// ---------------------------------------------------------------------------
async function getAdvisors() {
  const url = `${API_BASE}/v1/projects/${PROJECT_REF}/advisors/performance`;
  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

async function getSecurityAdvisors() {
  const url = `${API_BASE}/v1/projects/${PROJECT_REF}/advisors/security`;
  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    // Security endpoint puede no estar disponible en todos los tiers
    if (res.status === 404 || res.status === 403) return [];
    const body = await res.text();
    throw new Error(`Security API error ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Normalizar nivel
// ---------------------------------------------------------------------------
function normalizeLevel(raw) {
  const upper = (raw ?? '').toUpperCase();
  if (upper === 'CRITICAL' || upper === 'ERROR') return 'CRITICAL';
  if (upper === 'WARN' || upper === 'WARNING') return 'WARN';
  return 'INFO';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log(`${c.cyan}${c.bold}HIS Multipaís — Supabase Advisors Check${c.reset}`);
  log(`${c.dim}Proyecto: ${PROJECT_REF}${c.reset}`);
  log(`${c.dim}Timestamp: ${new Date().toISOString()}${c.reset}`);
  log('');

  let rawPerf = [];
  let rawSec = [];

  try {
    [rawPerf, rawSec] = await Promise.all([getAdvisors(), getSecurityAdvisors()]);
  } catch (err) {
    log(`${c.red}ERROR al consultar la API de Supabase: ${err.message}${c.reset}`);
    process.exit(2);
  }

  // Unificar y normalizar
  const all = [
    ...rawPerf.map((a) => ({ ...a, _category: 'performance' })),
    ...rawSec.map((a) => ({ ...a, _category: 'security' })),
  ];

  const advisors = all.map((a) => ({
    name: a.name ?? a.title ?? 'unknown',
    level: normalizeLevel(a.level ?? a.severity),
    category: a._category,
    description: a.description ?? a.detail ?? '',
    recommendation: a.recommendation ?? '',
  }));

  // Resumen
  const summary = { CRITICAL: 0, WARN: 0, INFO: 0 };
  for (const a of advisors) {
    summary[a.level] = (summary[a.level] ?? 0) + 1;
  }

  // Imprimir a stderr (legible por humanos)
  if (advisors.length === 0) {
    log(`${c.green}Sin advisors activos. Todo en orden.${c.reset}`);
  } else {
    for (const a of advisors) {
      log(`${badge(a.level)} [${a.category}] ${c.bold}${a.name}${c.reset}`);
      if (a.description) log(`  ${c.dim}${a.description}${c.reset}`);
      if (a.recommendation) log(`  Recomendacion: ${a.recommendation}`);
      log('');
    }
  }

  log(`Resumen: CRITICAL=${summary.CRITICAL}  WARN=${summary.WARN}  INFO=${summary.INFO}`);

  // Emitir JSON a stdout
  const report = {
    checkedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    summary,
    advisors,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  // Exit code
  if (summary.CRITICAL > 0) {
    log(`${c.red}${c.bold}CRITICAL advisors presentes — exit 2${c.reset}`);
    process.exit(2);
  }
  if (summary.WARN > 0) {
    log(`${c.yellow}${c.bold}WARN advisors presentes — exit 1${c.reset}`);
    process.exit(1);
  }

  log(`${c.green}${c.bold}OK — sin issues${c.reset}`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(2);
});
