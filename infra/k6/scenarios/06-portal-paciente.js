// scenarios/06-portal-paciente.js — flujo portal: login + consulta de resultados.
//
// 5 VUs x 2 min. Simula pacientes accediendo a su portal de resultados de laboratorio.
// El portal usa autenticación separada (portalProcedure) con JWT propio.
//
// Flujo:
//   1. Login Supabase Auth (igual que el resto)
//   2. GET /api/trpc/portal.labResults.list — resultados de laboratorio del paciente
//
// Nota: el portal requiere que el usuario sea un portal account activo en BD.
// En ambiente de prueba usar el usuario qa.admin@his.test que tiene acceso.
//
// Variables de entorno requeridas:
//   K6_USER_EMAIL, K6_USER_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY

import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL, DEFAULT_THRESHOLDS, THINK_TIME_MIN, THINK_TIME_MAX } from '../lib/config.js';
import { loginSupabase, authHeaders } from '../lib/auth.js';
import { checkTrpcOk, checkResponseTime } from '../lib/checks.js';

export const options = {
  vus: 5,
  duration: '2m',
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    'http_req_duration{name:portal_labResults}': ['p(95) < 1500'],
  },
};

export function setup() {
  const session = loginSupabase();
  if (!session) {
    throw new Error('[06-portal-paciente] Login fallido en setup() — abortando scenario.');
  }
  return { accessToken: session.accessToken };
}

export default function (data) {
  const headers = authHeaders(data.accessToken);

  // tRPC GET query — portal.labResults.list no recibe input
  const input = encodeURIComponent(JSON.stringify({}));
  const res = http.get(
    `${BASE_URL}/api/trpc/portal.labResults.list?input=${input}`,
    { headers, tags: { name: 'portal_labResults' } }
  );

  // Aceptamos 200 (datos encontrados) o 401/403 si el usuario no es portal account.
  // Lo que validamos es que no haya 500 y que la latencia sea aceptable.
  checkTrpcOk(res);
  checkResponseTime(res, 2000);

  sleep(THINK_TIME_MIN + Math.random() * (THINK_TIME_MAX - THINK_TIME_MIN));
}
