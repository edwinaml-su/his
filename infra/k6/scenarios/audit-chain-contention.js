// scenarios/audit-chain-contention.js — R4.1 (plan de remediación 2026-09,
// aprobado por Edwin). Mide la serialización del audit hash chain
// (packages/database/sql/05_audit_hash_chain.sql) bajo escritura concurrente.
//
// fn_audit_log_chain() (trigger BEFORE INSERT en audit."AuditLog") hace
// `LOCK TABLE audit."AuditLog" IN EXCLUSIVE MODE` en CADA insert para
// encadenar prevHash→signatureHash sin bifurcaciones — es decir, TODA
// escritura auditada del sistema (cualquier tabla del array `audited` en
// 02_audit_triggers.sql) contiende por ese único lock global, no solo las
// escrituras sobre la misma fila. Este scenario, además, apunta N VUs a la
// MISMA fila (E2E_FIXTURES.bedFreeId, ver apps/web/e2e/_helpers/fixtures.ts)
// para apilar el row-lock de Postgres sobre `Bed` encima del lock de la
// cadena — el peor caso realista (ej. dos estaciones de enfermería
// actualizando el mismo registro de cama casi al mismo tiempo).
//
// Por qué `bed.update` (packages/trpc/src/routers/bed.router.ts) y no otra
// mutación auditada:
//   1. Es de las más baratas del árbol tRPC sobre una tabla auditada: 1
//      SELECT + 1 UPDATE sin side-effects clínicos (a diferencia de
//      dispensación, admisión, indicaciones, etc., que además de auditar
//      encadenan otros triggers/cargos).
//   2. A diferencia de `bed.setActive` (mismo router, línea ~452 —
//      `if (existing.active === input.active) return existing`), `bed.update`
//      NO tiene atajo idempotente: SIEMPRE hace el UPDATE y por lo tanto
//      SIEMPRE dispara `trg_audit_Bed` → una fila nueva en audit."AuditLog"
//      por request. Con `setActive`, VUs que repiten el mismo valor no
//      generarían escritura real y el scenario mediría el atajo, no la
//      contención.
//   3. `isolation` (texto libre, ≤40 chars) es el único campo editable sin
//      validar contra catálogos/GLN — no arrastra I/O extra que contamine
//      la medición del lock.
//
// Requiere rol ADMIN/DIR (adminProc) — usar qa.admin@his.test (seed-test-users.mjs).
//
// Uso local (contra el stack efímero de e2e-smoke.yml / docker-compose.test.yml):
//   k6 run -e BASE_URL=http://localhost:3000 -e SUPABASE_URL=http://localhost:9999 \
//     -e SUPABASE_ANON_KEY=<generado por scripts/gotrue-test-jwt.mjs anon> \
//     -e K6_USER_EMAIL=qa.admin@his.test -e K6_USER_PASSWORD=TestPass123! \
//     -e VUS=20 -e DURATION=1m \
//     infra/k6/scenarios/audit-chain-contention.js
//
// ⚠️ NO verificado en vivo (sin runtime Docker en esta sesión — mismo caveat
// que docker-compose.test.yml y lib/trpc.js). `sessionCookieHeader`
// (lib/auth.js) está construido leyendo el código de @supabase/ssr y
// @supabase/supabase-js, no probado contra GoTrue real. Antes de la primera
// corrida en `perf-k6-local.yml`: 1 VU x 10s con `--http-debug=full` y
// confirmar que `bed.update` responde 200 (no 401/403) y que aparece una
// fila nueva en `/audit` (entidad `Bed`, id = K6_BED_ID) por iteración.
import { sleep } from 'k6';
import { sessionCookieHeader } from '../lib/auth.js';
import { trpcMutation, checkTrpcResult } from '../lib/trpc.js';

// E2E_FIXTURES.bedFreeId (apps/web/e2e/_helpers/fixtures.ts) — cama E2E-01,
// sembrada por packages/database/scripts/seed-e2e-fixtures.mjs. Overridable
// por si se corre contra otro ambiente con datos propios.
const BED_ID = __ENV.K6_BED_ID || 'e2ef1000-0000-4000-8000-0000000000b1';

export const options = {
  vus: parseInt(__ENV.VUS || '10', 10),
  duration: __ENV.DURATION || '1m',
  // Informativo, no gate: el objetivo es OBSERVAR cómo degrada la latencia
  // con la contención (el LOCK TABLE EXCLUSIVE serializa TODOS los inserts
  // de auditoría del sistema, no solo los de esta cama), no aprobar/reprobar
  // un SLO. `perf-k6-local.yml` corre este step con `continue-on-error: true`.
  thresholds: {
    'http_req_duration{name:bed_update_contention}': ['p(95)<5000'],
    checks: ['rate>0.95'],
  },
};

export function setup() {
  const session = sessionCookieHeader(__ENV.K6_USER_EMAIL || 'qa.admin@his.test', __ENV.K6_USER_PASSWORD);
  if (!session) {
    throw new Error('[audit-chain-contention] Login fallido en setup() — abortando scenario.');
  }
  return { cookie: session.header };
}

export default function (data) {
  const headers = { Cookie: data.cookie };

  // Valor único por request — no por idempotencia (bed.update no la tiene),
  // sino para dejar evidencia legible del orden de llegada real en el visor
  // /audit (afterJson.isolation) al comparar contra el timestamp del request.
  const isolation = `k6-contention-${__VU}-${__ITER}-${Date.now()}`;
  const result = trpcMutation(
    'bed.update',
    { id: BED_ID, isolation },
    headers,
    { name: 'bed_update_contention' },
  );
  checkTrpcResult(result, 'bed.update (contención audit chain)');

  // Jitter mínimo (no think-time humano): el punto es maximizar la presión
  // concurrente sobre el mismo lock, no simular un usuario real.
  sleep(Math.random() * 0.2);
}
