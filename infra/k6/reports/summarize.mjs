#!/usr/bin/env node
// reports/summarize.mjs — genera un resumen HTML legible a partir del JSON
// exportado por k6 (`--summary-export=reports/<scenario>-summary.json`).
//
// Uso:
//   node infra/k6/reports/summarize.mjs infra/k6/reports/a-latencia-baseline-summary.json
//
// Entrada: el JSON que produce `--summary-export` (formato "end-of-test
// summary" de k6 — un objeto con `metrics.<nombre>.values`, no el stream de
// `--out json=...` que es NDJSON punto-por-punto).
//
// Salida: <mismo-nombre>.html al lado del JSON de entrada.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Uso: node summarize.mjs <ruta-a-k6-summary.json>');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(inputPath, 'utf-8'));
const metrics = raw.metrics || {};

function fmt(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return Math.round(n * 100) / 100;
}

function metricRow(name, m) {
  const v = m.values || {};
  return `<tr>
    <td>${name}</td>
    <td>${fmt(v.avg)}</td>
    <td>${fmt(v['p(90)'])}</td>
    <td>${fmt(v['p(95)'])}</td>
    <td>${fmt(v['p(99)'])}</td>
    <td>${fmt(v.max)}</td>
  </tr>`;
}

const durationMetrics = Object.entries(metrics).filter(
  ([name, m]) => m.type === 'trend' && /duration/i.test(name),
);
const rateMetrics = Object.entries(metrics).filter(([, m]) => m.type === 'rate');
const counterMetrics = Object.entries(metrics).filter(([, m]) => m.type === 'counter');

// NO confiamos en el booleano que exporta k6 (`m.thresholds[expr]`).
//
// Verificado en vivo (REQ-HIS-PERF-001, escenario B, 2026-08-18): k6 v2.2.0
// exportó `"p(95)<400": true` en el JSON de `--summary-export` para una
// métrica cuyo p(95) real era 1444.6ms (falla por 3.6x) — la terminal, en
// el mismo run, sí mostró el ✗ correcto en vivo. Es un bug/quirk conocido
// de k6 con thresholds sobre sub-métricas de tag compuesto
// (`{op:read,phase:load}`), no un error nuestro de lectura del JSON —
// además el código original de este archivo SÍ tenía un bug propio (leía
// `res.ok` asumiendo `{ok: boolean}` cuando el valor real es un booleano
// plano, lo que hacía que TODO saliera "FAIL" siempre, incluyendo runs que
// habían pasado). Doble motivo para no depender de ese campo: evaluamos el
// threshold nosotros mismos contra el valor medido real.
function parseThresholdExpr(expr) {
  // Formatos soportados: "p(95)<400", "rate<0.01", "rate>0.99", "count==0".
  const m = /^(.+?)\s*(<=|>=|==|<|>)\s*(-?[\d.]+)$/.exec(expr.trim());
  if (!m) return null;
  return { field: m[1].trim(), op: m[2], target: Number(m[3]) };
}

/**
 * getField — el JSON de `--summary-export` tiene DOS formas distintas según
 * el tipo de métrica (verificado en vivo, k6 v2.2.0):
 *   - trend (ej. http_req_duration): los percentiles viven en `m.values`.
 *   - rate  (ej. checks, http_req_failed): NO hay `m.values` — el campo
 *     "rate" vive directo en `m.value` (junto a `m.passes`/`m.fails`).
 *   - counter (ej. http_reqs): `m.count` / `m.rate` directo en el objeto.
 */
function getField(m, field) {
  if (m.values && field in m.values) return m.values[field];
  if (field === 'rate') return m.value ?? m.rate;
  if (field === 'count') return m.count;
  return m[field];
}

function evalThreshold(expr, m) {
  const parsed = parseThresholdExpr(expr);
  if (!parsed) return null; // no se pudo parsear — se reporta como desconocido, no se inventa un resultado.
  const actual = getField(m, parsed.field);
  if (actual === undefined || actual === null || Number.isNaN(actual)) return null;
  switch (parsed.op) {
    case '<': return actual < parsed.target;
    case '<=': return actual <= parsed.target;
    case '>': return actual > parsed.target;
    case '>=': return actual >= parsed.target;
    case '==': return actual === parsed.target;
    default: return null;
  }
}

const thresholdRows = Object.entries(metrics)
  .filter(([, m]) => m.thresholds)
  .flatMap(([name, m]) =>
    Object.keys(m.thresholds).map((expr) => ({
      name,
      expr,
      ok: evalThreshold(expr, m),
    })),
  );

// ok puede ser true/false/null (null = expresión no parseable o campo
// ausente en `values` — se reporta como "N/D", nunca se asume PASS).
const allThresholdsOk = thresholdRows.length > 0 && thresholdRows.every((t) => t.ok === true);
const anyUnknown = thresholdRows.some((t) => t.ok === null);
const scenarioName = basename(inputPath).replace(/-summary\.json$/, '').replace(/\.json$/, '');

const html = `<!doctype html>
<html lang="es-SV">
<head>
<meta charset="utf-8" />
<title>k6 — ${scenarioName}</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: right; font-size: 0.85rem; }
  th:first-child, td:first-child { text-align: left; }
  th { background: #f4f4f4; }
  .pass { color: #0a7a2f; font-weight: 600; }
  .fail { color: #b3261e; font-weight: 600; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 0.85rem; }
  .badge.pass { background: #e5f6ea; }
  .badge.fail { background: #fbe7e5; }
</style>
</head>
<body>
  <h1>Reporte k6 — ${scenarioName}</h1>
  <p>Veredicto global de thresholds:
    <span class="badge ${allThresholdsOk ? 'pass' : 'fail'}">${allThresholdsOk ? 'PASS' : 'FAIL'}</span>
    ${anyUnknown ? '<span style="color:#a67c00"> — hay thresholds no evaluables, ver tabla (N/D)</span>' : ''}
  </p>

  <h2>Thresholds (SLO)</h2>
  <table>
    <tr><th>Métrica</th><th>Expresión</th><th>Resultado</th></tr>
    ${thresholdRows
      .map((t) => {
        const label = t.ok === null ? 'N/D' : t.ok ? 'PASS' : 'FAIL';
        const cls = t.ok === null ? '' : t.ok ? 'pass' : 'fail';
        return `<tr><td>${t.name}</td><td>${t.expr}</td><td class="${cls}">${label}</td></tr>`;
      })
      .join('\n    ')}
  </table>

  <h2>Latencias (ms)</h2>
  <table>
    <tr><th>Métrica</th><th>avg</th><th>p90</th><th>p95</th><th>p99</th><th>max</th></tr>
    ${durationMetrics.map(([name, m]) => metricRow(name, m)).join('\n    ')}
  </table>

  <h2>Tasas</h2>
  <table>
    <tr><th>Métrica</th><th>rate</th></tr>
    ${rateMetrics
      .map(([name, m]) => `<tr><td>${name}</td><td>${fmt(getField(m, 'rate'))}</td></tr>`)
      .join('\n    ')}
  </table>

  <h2>Contadores</h2>
  <table>
    <tr><th>Métrica</th><th>count</th></tr>
    ${counterMetrics
      .map(([name, m]) => `<tr><td>${name}</td><td>${fmt(getField(m, 'count'))}</td></tr>`)
      .join('\n    ')}
  </table>

  <p style="color:#666; font-size:0.8rem;">Generado por infra/k6/reports/summarize.mjs a partir de ${basename(inputPath)}.</p>
</body>
</html>`;

const outPath = join(dirname(inputPath), `${scenarioName}.html`);
writeFileSync(outPath, html, 'utf-8');
console.log(`Reporte HTML escrito en: ${outPath}`);
