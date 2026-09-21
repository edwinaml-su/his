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
import encoding from 'k6/encoding';

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
 *
 * ⚠️ NO verificado contra la app real (hallazgo de lectura de código,
 * 2026-09-21): `apps/web/src/app/api/trpc/[trpc]/route.ts` resuelve el
 * usuario con `getCurrentUser()` (apps/web/src/lib/auth/session.ts), que lee
 * la sesión de Supabase desde las COOKIES de @supabase/ssr — no existe
 * ningún lugar en apps/web que lea `Authorization: Bearer` para poblar
 * `ctx.user`. Un procedure `protectedProcedure`/`tenantProcedure` llamado
 * solo con este header (sin cookie) muy probablemente responde UNAUTHORIZED
 * aunque el login contra Supabase Auth REST (arriba) haya devuelto 200 — el
 * token es válido, pero la app nunca lo lee de ahí. Los scenarios 02/03/04
 * (auth-baseline, triage-queue, bed-map-read) usan este helper y NUNCA
 * corrieron contra una app real (perf-k6.yml es manual y no se ha
 * disparado — ver CLAUDE.md §CI/CD). Antes de la primera corrida real:
 * verificar con `--http-debug=full` si el status es 200 o 401; si es 401,
 * migrar esos 3 scenarios a `sessionCookieHeader()` (abajo), igual que
 * `lib/setup.js`/la suite A-F.
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

/**
 * sessionCookieHeader — autentica con Supabase Auth REST y arma la cookie
 * `sb-<ref>-auth-token` que @supabase/ssr espera del lado del servidor
 * (apps/web/src/lib/supabase/server.ts → createServerClient → getCurrentUser()
 * en apps/web/src/lib/auth/session.ts). A diferencia de `authHeaders` (Bearer,
 * ver su comentario), esto sí es lo que la app realmente lee.
 *
 * Formato construido leyendo node_modules/@supabase/ssr y
 * node_modules/@supabase/supabase-js (no hay doc pública que lo fije como
 * API estable, es un detalle de implementación):
 *   - nombre del cookie: `sb-${hostname.split('.')[0]}-auth-token`
 *     (supabase-js, defaultStorageKey — ej. SUPABASE_URL=http://localhost:9999
 *     → "sb-localhost-auth-token"; https://ejacvsgbewcerxtjtwto.supabase.co
 *     → "sb-ejacvsgbewcerxtjtwto-auth-token").
 *   - valor: prefijo literal "base64-" + base64url SIN padding (alfabeto
 *     `-_`, sin `=`) del JSON.stringify(session) — ver
 *     @supabase/ssr, dist/main/cookies.js (BASE64_PREFIX + stringToBase64URL);
 *     cookieEncoding por defecto es "base64url" en createServerClient.
 *   - `session` es la forma que persiste GoTrueClient#_saveSession: access_token,
 *     token_type, expires_in, expires_at, refresh_token, user — tal cual los
 *     devuelve POST /auth/v1/token?grant_type=password (con expires_at
 *     calculado si el backend no lo manda).
 *
 * ⚠️ NO verificado en vivo (sin runtime Docker en esta sesión, mismo caveat
 * que docker-compose.test.yml). Antes de la primera corrida real: 1 VU x 10s
 * con `--http-debug=full` y confirmar que el mutation protegido responde 200,
 * no 401/403 — si falla, sospechar primero de un cookie chunking (sesiones
 * grandes se parten en `sb-<ref>-auth-token.0`, `.1`, ... — ver el chunker de
 * @supabase/ssr) que este helper no implementa.
 *
 * También corrige el import roto de `lib/setup.js` (buildAuthedContext),
 * que ya llamaba a `sessionCookieHeader` sin que existiera en este archivo.
 *
 * @param {string} [email]    — sobrescribe K6_USER_EMAIL
 * @param {string} [password] — sobrescribe K6_USER_PASSWORD
 * @returns {{ header: string, userId: string|undefined, accessToken: string } | null}
 */
export function sessionCookieHeader(email, password) {
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
        'Content-Type': 'application/json',
        'apikey':       SUPABASE_ANON_KEY,
      },
      tags: { name: 'auth_login_cookie' },
    }
  );

  const ok = check(res, { 'login (cookie) status 200': (r) => r.status === 200 });
  if (!ok) {
    console.error(`[auth] Login (cookie) fallido: ${res.status} — ${res.body}`);
    return null;
  }

  let body;
  try {
    body = JSON.parse(res.body);
  } catch (e) {
    console.error(`[auth] Login (cookie): respuesta no-JSON: ${e}`);
    return null;
  }
  if (!body.access_token) {
    console.error('[auth] Login (cookie): respuesta sin access_token.');
    return null;
  }

  const session = {
    access_token: body.access_token,
    token_type: body.token_type || 'bearer',
    expires_in: body.expires_in,
    expires_at: body.expires_at || Math.floor(Date.now() / 1000) + (body.expires_in || 3600),
    refresh_token: body.refresh_token,
    user: body.user,
  };

  const hostname = SUPABASE_URL.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  const cookieName = `sb-${hostname.split('.')[0] || 'localhost'}-auth-token`;
  const cookieValue = 'base64-' + encoding.b64encode(JSON.stringify(session), 'rawurl');

  return {
    header: `${cookieName}=${cookieValue}`,
    userId: body.user && body.user.id,
    accessToken: body.access_token,
  };
}
