// scenarios/f-resiliencia-dos.js — REQ-HIS-PERF-001 §8-F.
//
// Esto es VALIDACIÓN DE CONTROLES DEFENSIVOS, no generación de tráfico de
// ataque (§1/§2 del REQ). Cada sub-prueba confirma que un control existente
// responde como se documenta en el código — no intenta tumbar nada.
//
// Contexto real de este despliegue (corrige §3/§8-F del REQ original, que
// asume Kong): NO hay API Gateway. Los controles viven en la app:
//   - Rate limit anónimo:      60 req/min por IP   → packages/trpc/src/middleware/rate-limit.ts
//                               (Postgres, tabla RateLimitHit) vía
//                               apps/web/src/lib/trpc/rate-limit-global.ts
//   - Rate limit autenticado:  600 req/min por usuario, en memoria del proceso
//                               (rate-limit-global.ts) — NO sirve como límite
//                               global multi-pod, es amortiguador anti-bucle.
//   - Tope de batch tRPC:      20 procedures/request → apps/web/src/lib/trpc/batch-limit.ts
//                               (413 si se excede, ANTES de tocar sesión/BD).
//   - Backpressure a BD:       Prisma connection pool (ver DATABASE_URL) — no
//                               hay circuit breaker explícito documentado; este
//                               escenario observa si un pico de escritura hace
//                               que las lecturas se degraden en cascada.
//
// Lo que NO se puede validar con k6 puro (documentarlo, no fingir que se hizo):
//   - "slow clients" / conexión lenta byte-a-byte: k6 no tiene control fino
//     de framing TCP — requeriría una herramienta dedicada (slowhttptest,
//     xk6-timers a nivel socket). Se deja como pendiente explícito, NO se
//     reporta un PASS/FAIL inventado para esto.
//
// Uso:
//   k6 run -e BASE_URL=http://localhost:3000 scenarios/f-resiliencia-dos.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL } from '../lib/config.js';
import { assertLocalTarget } from '../lib/guard.js';
import { stagesResilience } from '../config/stages.js';
import { buildAuthedContext } from '../lib/setup.js';
import { trpcQuery, trpcMutation } from '../lib/trpc.js';

assertLocalTarget(BASE_URL);

const rateLimit429Count = new Counter('rl_anon_429_count');
const rateLimit200Count = new Counter('rl_anon_200_count');
const rateLimitCascade5xx = new Counter('rl_anon_5xx_count'); // DEBE quedar en 0.
const batchLimit413 = new Counter('batch_limit_413_seen');
const oversizedRejected = new Counter('oversized_payload_rejected');

export const options = {
  stages: stagesResilience,
  thresholds: {
    // El control NO debe fallar en cascada — cero 5xx en la ráfaga anónima
    // es el criterio duro de este escenario (§8-F: "sin cascada de 5xx").
    rl_anon_5xx_count: ['count==0'],
  },
};

export function setup() {
  return buildAuthedContext();
}

/**
 * burstAnonRateLimit — dispara 80 requests anónimas seguidas contra un
 * endpoint público (country.list) para cruzar el umbral documentado de
 * 60/min. Reporta cuántas dieron 200 vs 429 vs 5xx.
 */
function burstAnonRateLimit() {
  for (let i = 0; i < 80; i++) {
    const res = http.get(`${BASE_URL}/api/trpc/country.list?batch=1&input=${encodeURIComponent('{"0":{"json":{}}}')}`, {
      tags: { name: 'country.list(anon-burst)' },
    });
    if (res.status === 429) rateLimit429Count.add(1);
    else if (res.status === 200) rateLimit200Count.add(1);
    else if (res.status >= 500) rateLimitCascade5xx.add(1);

    check(res, {
      'rate-limit anon: status es 200 o 429 (no 5xx)': (r) => r.status === 200 || r.status === 429,
    });
    if (res.status === 429) {
      check(res, {
        'rate-limit anon: 429 trae header retry-after': (r) => r.headers['Retry-After'] !== undefined,
      });
    }
  }
}

/** batchSizeGuard — confirma que un batch de 21 procedures (> TRPC_MAX_BATCH_SIZE=20) da 413. */
function batchSizeGuard(ctx) {
  const procs = new Array(21).fill('country.list').join(',');
  const res = http.get(`${BASE_URL}/api/trpc/${procs}?batch=1`, {
    headers: ctx.headers,
    tags: { name: 'batch-size-guard(21-procs)' },
  });
  const ok = check(res, {
    'batch de 21 procedures: 413': (r) => r.status === 413,
  });
  if (ok) batchLimit413.add(1);
}

/** oversizedPayload — un firstName de 2MB debe rechazarse (Zod max(120)), no colgar el server. */
function oversizedPayload(ctx) {
  const huge = 'A'.repeat(2 * 1024 * 1024);
  const result = trpcMutation(
    'patient.create',
    { firstName: huge, biologicalSexId: ctx.biologicalSexId, isUnknown: false, traeDocumento: false },
    ctx.headers,
    { name: 'oversized-payload(2MB-firstName)' },
  );
  const rejected = !result.ok && result.res.status >= 400 && result.res.status < 500;
  check(result, {
    'payload 2MB: rechazado con 4xx (no 5xx, no timeout)': () => rejected,
  });
  if (rejected) oversizedRejected.add(1);
}

/** connectionDegradation — durante la ráfaga anónima, una lectura autenticada normal
 *  debe seguir respondiendo (degradación controlada, no caída total). */
function connectionDegradationCheck(ctx) {
  const res = trpcQuery('census.bedMap', {}, ctx.headers, { name: 'census.bedMap(durante-rafaga)' });
  check(res, {
    'lectura autenticada normal sigue respondiendo durante la ráfaga': (r) => r.ok === true || (r.res && r.res.status === 429),
  });
}

export default function (ctx) {
  burstAnonRateLimit();
  batchSizeGuard(ctx);
  oversizedPayload(ctx);
  connectionDegradationCheck(ctx);
  sleep(1);
}

export function teardown() {
  console.log(
    '[f-resiliencia-dos] Revisar en el resumen: rl_anon_429_count (debe ser >0 si se cruzó el ' +
      'umbral de 60/min), rl_anon_5xx_count (debe ser 0), batch_limit_413_seen (debe ser >0), ' +
      'oversized_payload_rejected (debe ser >0). "slow clients" queda documentado como NO EJECUTADO.',
  );
}
