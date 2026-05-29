// scenarios/01-smoke.js — smoke test: 1 VU x 30s.
//
// Objetivo: validar que la app responde antes de correr cualquier otro scenario.
// Corre en < 1 min. Si esto falla, no tiene sentido continuar con otros scenarios.
//
// Uso local:
//   docker run --rm -i -e BASE_URL=http://localhost:3000 \
//     -v "$PWD/infra/k6:/scripts" grafana/k6:latest run /scripts/scenarios/01-smoke.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, DEFAULT_THRESHOLDS } from '../lib/config.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: DEFAULT_THRESHOLDS,
};

export default function () {
  // La raíz de Next.js redirige al login — aceptamos 200 o 307.
  const res = http.get(`${BASE_URL}/`, { tags: { name: 'root' } });
  check(res, {
    'root responde (200 o 307)': (r) => r.status === 200 || r.status === 307,
    'respuesta < 2s':            (r) => r.timings.duration < 2000,
  });

  sleep(1);

  // Health check implícito: la página de login debe cargar.
  const loginRes = http.get(`${BASE_URL}/login`, { tags: { name: 'login_page' } });
  check(loginRes, {
    'login page 200': (r) => r.status === 200,
    'login page < 2s': (r) => r.timings.duration < 2000,
  });

  sleep(1);
}
