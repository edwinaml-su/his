// scenarios/03-triage-queue.js — carga moderada sobre triage.listPending.
//
// 10 VUs x 2 min. Simula operadores de triage consultando la cola.
// Endpoint: GET /api/trpc/triage.listPending (tenantProcedure, requiere auth + org).
//
// Nota: tRPC GET queries se invocan como:
//   /api/trpc/<router>.<procedure>?input=<JSON_encoded>
//
// Variables de entorno requeridas:
//   K6_USER_EMAIL, K6_USER_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY
//   K6_ORG_ID — UUID de la organización de prueba (cookie his.org)

import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL, DEFAULT_THRESHOLDS, THINK_TIME_MIN, THINK_TIME_MAX } from '../lib/config.js';
import { loginSupabase, authHeaders } from '../lib/auth.js';
import { checkTrpcOk, checkResponseTime } from '../lib/checks.js';

export const options = {
  vus: 10,
  duration: '2m',
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    'http_req_duration{name:triage_listPending}': ['p(95) < 1000'],
  },
};

// setup() corre una sola vez antes de los VUs — obtiene el token de sesión.
export function setup() {
  const session = loginSupabase();
  if (!session) {
    throw new Error('[03-triage-queue] Login fallido en setup() — abortando scenario.');
  }
  return { accessToken: session.accessToken };
}

export default function (data) {
  const headers = authHeaders(data.accessToken);

  // tRPC query GET: input vacío (listPending no recibe parámetros)
  const input = encodeURIComponent(JSON.stringify({}));
  const res = http.get(
    `${BASE_URL}/api/trpc/triage.listPending?input=${input}`,
    { headers, tags: { name: 'triage_listPending' } }
  );

  checkTrpcOk(res);
  checkResponseTime(res, 1500);

  // Think time variable simula comportamiento humano real.
  sleep(THINK_TIME_MIN + Math.random() * (THINK_TIME_MAX - THINK_TIME_MIN));
}
