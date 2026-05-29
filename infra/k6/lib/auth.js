// lib/auth.js — helper de autenticación para escenarios k6 de HIS.
//
// La app usa Supabase Auth directamente (signInWithPassword en el browser).
// Desde k6 llamamos al endpoint REST de Supabase Auth en lugar de la UI.
//
// Variables de entorno requeridas (NUNCA hardcodear):
//   K6_USER_EMAIL       — email del usuario de prueba
//   K6_USER_PASSWORD    — password del usuario de prueba
//   SUPABASE_URL        — URL base de Supabase (ej. https://<ref>.supabase.co)
//   SUPABASE_ANON_KEY   — anon key pública de Supabase

import http from 'k6/http';
import { check } from 'k6';

const SUPABASE_URL  = __ENV.SUPABASE_URL   || 'http://localhost:54321';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || '';

/**
 * loginSupabase — autentica con Supabase Auth REST API.
 *
 * Devuelve { accessToken, tokenType } o falla el check si el login falla.
 * El accessToken se pasa como Bearer en cada request protegido.
 *
 * @param {string} [email]    — sobrescribe K6_USER_EMAIL
 * @param {string} [password] — sobrescribe K6_USER_PASSWORD
 * @returns {{ accessToken: string, tokenType: string } | null}
 */
export function loginSupabase(email, password) {
  const userEmail    = email    || __ENV.K6_USER_EMAIL    || '';
  const userPassword = password || __ENV.K6_USER_PASSWORD || '';

  if (!userEmail || !userPassword) {
    console.error('[auth] K6_USER_EMAIL o K6_USER_PASSWORD no definidos.');
    return null;
  }

  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: userEmail, password: userPassword }),
    {
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_ANON_KEY,
      },
      tags: { name: 'auth_login' },
    }
  );

  const ok = check(res, {
    'login status 200': (r) => r.status === 200,
    'login tiene access_token': (r) => {
      try {
        return JSON.parse(r.body).access_token !== undefined;
      } catch (_) {
        return false;
      }
    },
  });

  if (!ok) {
    console.error(`[auth] Login fallido: ${res.status} — ${res.body}`);
    return null;
  }

  const body = JSON.parse(res.body);
  return {
    accessToken: body.access_token,
    tokenType:   body.token_type || 'bearer',
  };
}

/**
 * authHeaders — construye el header Authorization para requests protegidos.
 * Incluye también la apikey de Supabase que el proxy de Next.js no requiere,
 * pero que el endpoint directo de tRPC sí puede necesitar.
 *
 * @param {string} accessToken
 * @returns {Object} headers listos para pasar a http.get/post
 */
export function authHeaders(accessToken) {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
}
