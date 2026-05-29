// scenarios/04-bed-map-read.js — carga read-heavy sobre bed.getMap.
//
// 20 VUs x 2 min. Simula el mapa de camas siendo consultado por múltiples
// estaciones de trabajo simultáneamente (jefe de enfermería, admisiones, etc.).
// Endpoint: GET /api/trpc/bed.getMap (tenantProcedure.query)
//
// Variables de entorno requeridas:
//   K6_USER_EMAIL, K6_USER_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY

import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL, DEFAULT_THRESHOLDS, THINK_TIME_MIN, THINK_TIME_MAX } from '../lib/config.js';
import { loginSupabase, authHeaders } from '../lib/auth.js';
import { checkTrpcOk, checkResponseTime } from '../lib/checks.js';

export const options = {
  vus: 20,
  duration: '2m',
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    'http_req_duration{name:bed_getMap}': ['p(95) < 1200'],
  },
};

export function setup() {
  const session = loginSupabase();
  if (!session) {
    throw new Error('[04-bed-map-read] Login fallido en setup() — abortando scenario.');
  }
  return { accessToken: session.accessToken };
}

export default function (data) {
  const headers = authHeaders(data.accessToken);

  const input = encodeURIComponent(JSON.stringify({}));
  const res = http.get(
    `${BASE_URL}/api/trpc/bed.getMap?input=${input}`,
    { headers, tags: { name: 'bed_getMap' } }
  );

  checkTrpcOk(res);
  checkResponseTime(res, 1500);

  sleep(THINK_TIME_MIN + Math.random() * (THINK_TIME_MAX - THINK_TIME_MIN));
}
