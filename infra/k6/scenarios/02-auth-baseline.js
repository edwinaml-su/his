// scenarios/02-auth-baseline.js — baseline de autenticación.
//
// 5 VUs x 1 min. Threshold estricto: p95 < 800ms para login.
// Detecta regresiones en el flujo de Supabase Auth.
//
// Variables de entorno requeridas:
//   K6_USER_EMAIL, K6_USER_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY

import { sleep } from 'k6';
import { AUTH_THRESHOLDS, BASE_URL, THINK_TIME_MIN } from '../lib/config.js';
import { loginSupabase } from '../lib/auth.js';
import { checkOk } from '../lib/checks.js';
import http from 'k6/http';

export const options = {
  vus: 5,
  duration: '1m',
  thresholds: {
    ...AUTH_THRESHOLDS,
    // Threshold específico para el tag 'auth_login'
    'http_req_duration{name:auth_login}': ['p(95) < 800'],
  },
};

export default function () {
  // 1. Autenticar vía Supabase Auth REST
  const session = loginSupabase();
  if (!session) {
    sleep(THINK_TIME_MIN);
    return;
  }

  sleep(1);

  // 2. Verificar que el dashboard principal responde con token válido.
  // Next.js lee el token de la cookie; desde k6 lo enviamos como header.
  const res = http.get(`${BASE_URL}/`, {
    headers: { 'Authorization': `Bearer ${session.accessToken}` },
    tags: { name: 'dashboard_post_login' },
  });
  checkOk(res);

  sleep(THINK_TIME_MIN);
}
