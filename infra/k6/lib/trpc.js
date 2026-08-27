// lib/trpc.js — Cliente HTTP mínimo para tRPC v11 (httpBatchLink + superjson).
//
// La app usa `httpBatchLink` con `transformer: superjson` (ver
// apps/web/src/lib/trpc/react.tsx) contra `/api/trpc`. El route handler
// (apps/web/src/app/api/trpc/[trpc]/route.ts) acepta el mismo formato tanto
// para 1 procedure como para varios separados por coma en el path — acá
// SIEMPRE mandamos batch de tamaño 1 (un procedure por request HTTP), para
// que cada llamada quede como una métrica k6 independiente y legible por
// endpoint. El sobre (envelope) es el mismo que exige el servidor:
//
//   Query  (GET) : /api/trpc/<path>?batch=1&input={"0":{"json":<input>}}
//   Mutation(POST): /api/trpc/<path>?batch=1  body={"0":{"json":<input>}}
//   Respuesta     : [{"result":{"data":{"json":<output>}}}] | [{"error":{...}}]
//
// Verificado leyendo apps/web/src/lib/trpc/parse-batch.ts (parsea
// "/api/trpc/proc1,proc2,..." — confirma el path format) y
// apps/web/src/lib/trpc/rate-limit-global.ts (cuenta "count" = nº de
// procedures del batch — confirma que 1 request = 1 batch de N). El formato
// del ENVELOPE JSON (`{"0":{"json":...}}`) es el protocolo estándar de
// @trpc/client v11 con httpBatchLink — no es específico de este repo.
//
// NO verificado en vivo (ver docs/performance/REQ-HIS-PERF-001-resultados.md):
// esta sesión no logró levantar un entorno local para probar contra la app
// real. Antes de la primera corrida: `k6 run --http-debug=full -e VUS_A=1
// scenarios/a-latencia-baseline.js` y confirmar 200s reales antes de escalar.
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { check } from 'k6';
import { BASE_URL } from './config.js';

function envelope(input) {
  return JSON.stringify({ '0': { json: input === undefined ? null : input } });
}

function unwrap(res) {
  try {
    const body = JSON.parse(res.body);
    const item = Array.isArray(body) ? body[0] : body;
    if (item && item.error) {
      return { ok: false, error: item.error };
    }
    return { ok: true, data: item && item.result && item.result.data && item.result.data.json };
  } catch (e) {
    return { ok: false, error: { message: `respuesta no-JSON (status ${res.status}): ${e}` } };
  }
}

/**
 * trpcQuery — llama un procedure `query` (GET).
 * @param {string} path     - ej. 'census.bedMap'
 * @param {object} [input]  - input del procedure
 * @param {object} [headers]- headers extra (Cookie de sesión, etc.)
 * @param {object} [tags]   - tags k6 adicionales; `op` default 'read'
 */
// --- Conteo por clase de código HTTP (agregado 2026-08-18) ---------------
// Sin esto, un 18% de "errores" es ambiguo: puede ser el rate limit
// devolviendo 429 CORRECTAMENTE, o 5xx reales. La diferencia decide si el
// veredicto es "el sistema se protege" o "el sistema se rompe".
export const statusCounters = {
  s2xx: new Counter('status_2xx'),
  s401: new Counter('status_401'),
  s403: new Counter('status_403'),
  s413: new Counter('status_413'),
  s429: new Counter('status_429'),
  s4xx: new Counter('status_4xx_otros'),
  s5xx: new Counter('status_5xx'),
};
function contarStatus(res, tags) {
  const c = res.status;
  const t = { name: (tags && tags.name) || 'sin-nombre' };
  if (c >= 200 && c < 300) statusCounters.s2xx.add(1, t);
  else if (c === 401) statusCounters.s401.add(1, t);
  else if (c === 403) statusCounters.s403.add(1, t);
  else if (c === 413) statusCounters.s413.add(1, t);
  else if (c === 429) statusCounters.s429.add(1, t);
  else if (c >= 500) statusCounters.s5xx.add(1, t);
  else statusCounters.s4xx.add(1, t);
}

// Cabecera de Protection Bypass de Vercel. Sin ella, un preview protegido
// responde 429 con x-vercel-mitigated:challenge a todo cliente no-navegador
// y la corrida mediría la mitigación en vez de la aplicación.
const BYPASS_HEADERS = __ENV.VERCEL_BYPASS_TOKEN
  ? {
      'x-vercel-protection-bypass': __ENV.VERCEL_BYPASS_TOKEN,
      'x-vercel-set-bypass-cookie': 'samesitenone',
    }
  : {};

export function trpcQuery(path, input, headers, tags) {
  const q = encodeURIComponent(envelope(input));
  const res = http.get(`${BASE_URL}/api/trpc/${path}?batch=1&input=${q}`, {
    headers: Object.assign({ 'Content-Type': 'application/json' }, BYPASS_HEADERS, headers),
    // `phase:'load'` por default — setup.js lo pisa a 'setup' explícitamente.
    // Necesario porque k6 mete TODO http.get/post (incluido el de setup(),
    // que corre 1 vez, no por VU) en las métricas http_req_* globales; sin
    // este tag, un fallo de setup() (ej. catálogo vacío) contamina el error
    // rate de la corrida completa aunque no sea tráfico del flujo medido
    // (hallazgo real: primera corrida contra la app, 2026-08-18).
    tags: Object.assign({ name: path, op: 'read', phase: 'load' }, tags),
  });
  contarStatus(res, tags);
  return Object.assign({ res }, unwrap(res));
}

/**
 * trpcMutation — llama un procedure `mutation` (POST).
 */
export function trpcMutation(path, input, headers, tags) {
  const res = http.post(`${BASE_URL}/api/trpc/${path}?batch=1`, envelope(input), {
    headers: Object.assign({ 'Content-Type': 'application/json' }, BYPASS_HEADERS, headers),
    tags: Object.assign({ name: path, op: 'write', phase: 'load' }, tags),
  });
  contarStatus(res, tags);
  return Object.assign({ res }, unwrap(res));
}

/** checkTrpcResult — check() estándar "sin error tRPC" para un resultado de trpcQuery/trpcMutation. */
export function checkTrpcResult(result, label) {
  return check(result, {
    [`${label}: sin error tRPC`]: (r) => r.ok === true,
  });
}
