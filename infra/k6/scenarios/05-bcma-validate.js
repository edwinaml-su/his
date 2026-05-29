// scenarios/05-bcma-validate.js — carga sobre bedside.validate5Correctos (BCMA).
//
// 10 VUs x 2 min. Simula enfermeras escaneando medicamentos en bedside.
// Endpoint: POST /api/trpc/bedside.validate5Correctos (tenantProcedure.mutation)
//
// El payload usa datos ficticios (GTIN GS1 de ejemplo, GSRN sintéticos).
// El backend rechazará la solicitud por datos inválidos en BD — eso es esperado.
// Lo que medimos es la latencia de la capa de validación (parseo GS1 + DB lookup).
//
// Threshold: p95 < 1500ms — alineado con SLO clínico BCMA del TDR.
//
// Variables de entorno requeridas:
//   K6_USER_EMAIL, K6_USER_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY

import http from 'k6/http';
import { sleep, check } from 'k6';
import { BASE_URL, DEFAULT_THRESHOLDS, THINK_TIME_MIN, THINK_TIME_MAX } from '../lib/config.js';
import { loginSupabase, authHeaders } from '../lib/auth.js';
import { checkResponseTime } from '../lib/checks.js';

export const options = {
  vus: 10,
  duration: '2m',
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    // Para este scenario aceptamos más errores de negocio (datos de prueba ficticios),
    // pero la latencia debe cumplirse incluso en caso de error.
    'http_req_duration{name:bcma_validate}': ['p(95) < 1500'],
    // Aceptamos hasta 5% de errores HTTP (la app puede devolver 400 por datos inválidos).
    http_req_failed: ['rate < 0.05'],
  },
};

// Payload BCMA de ejemplo con datos sintéticos (GS1 formato real, IDs ficticios).
// GTIN: 14 dígitos GS1 de ejemplo (no corresponde a medicamento real).
const MOCK_PAYLOAD = {
  gsrnEnfermera:   '012345678901234567', // 18 dígitos
  gsrnPaciente:    '012345678901234560', // 18 dígitos
  gs1Medicamento:  '00312345678901', // GTIN 14 dígitos
  indicationId:    '00000000-0000-0000-0000-000000000001',
  glnUbicacion:    '7600000000000',
  timestamp:       new Date().toISOString(),
};

export function setup() {
  const session = loginSupabase();
  if (!session) {
    throw new Error('[05-bcma-validate] Login fallido en setup() — abortando scenario.');
  }
  return { accessToken: session.accessToken };
}

export default function (data) {
  const headers = authHeaders(data.accessToken);

  // tRPC mutations van como POST con body JSON { "0": { json: input } }
  const body = JSON.stringify({ '0': { json: MOCK_PAYLOAD } });

  const res = http.post(
    `${BASE_URL}/api/trpc/bedside.validate5Correctos`,
    body,
    { headers, tags: { name: 'bcma_validate' } }
  );

  // Para este scenario, aceptamos 200 (pass) o 400/422 (fallo de negocio por datos ficticios).
  // Lo que NO aceptamos es 500 (error interno) o timeout.
  check(res, {
    'no error 500': (r) => r.status !== 500,
    'no timeout':   (r) => r.timings.duration < 5000,
  });
  checkResponseTime(res, 1500);

  sleep(THINK_TIME_MIN + Math.random() * (THINK_TIME_MAX - THINK_TIME_MIN));
}
