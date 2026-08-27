// lib/setup.js — construcción de contexto compartido (ctx) para escenarios A-F.
//
// Pensado para usarse dentro de `export function setup() { ... }` de k6
// (corre UNA vez, antes de levantar VUs, y el resultado se pasa a
// `default function (ctx) { ... }` de cada VU/iteración).
//
// Usuarios de prueba: los mismos 5 sembrados por
// packages/database/scripts/seed-test-users.mjs (qa.physician@his.test,
// qa.nurse@his.test, etc. — password TestPass123!, NUNCA credenciales
// reales). Requiere que ese script ya haya corrido contra el Supabase local.
import { sessionCookieHeader } from './auth.js';
import { trpcQuery } from './trpc.js';

const DEFAULT_PASSWORD = 'TestPass123!';

/**
 * buildAuthedContext — login + catálogos base. Lanza (aborta la corrida)
 * si el login falla, en vez de dejar que la suite corra "en silencio" sin
 * sesión y produzca falsos 401 que se mezclarían con errores reales de SLO.
 *
 * @param {string} email - default qa.physician@his.test (rol MC — puede
 *   escribir en los 6 flujos; para escenarios que solo leen, usar
 *   qa.admin@his.test da igual resultado y es más barato de mantener).
 */
export function buildAuthedContext(email) {
  const userEmail = email || __ENV.K6_USER_EMAIL || 'qa.physician@his.test';
  const userPassword = __ENV.K6_USER_PASSWORD || DEFAULT_PASSWORD;

  const session = sessionCookieHeader(userEmail, userPassword);
  if (!session) {
    throw new Error(
      `[setup] Login falló para ${userEmail}. Verificá que ` +
        'packages/database/scripts/seed-test-users.mjs corrió contra el Supabase ' +
        'local y que SUPABASE_URL/SUPABASE_ANON_KEY apuntan a esa instancia.',
    );
  }

  const headers = { Cookie: session.header };

  // Verificación de humo: una llamada protegida barata. Si esto no da 200,
  // el encoding de la cookie de sesión (ver lib/auth.js) es la sospecha #1
  // — mejor abortar acá con un mensaje claro que dejar correr el escenario
  // entero contra 401s y reportar un SLO falso.
  const smoke = trpcQuery('organization.listMine', {}, headers, { name: 'setup:smoke-auth', phase: 'setup' });
  if (!smoke.ok) {
    throw new Error(
      `[setup] La sesión se creó pero organization.listMine devolvió error: ` +
        `${JSON.stringify(smoke.error)}. El encoding de la cookie (lib/auth.js, ` +
        'sessionCookieHeader) está verificado contra la app real — si esto falla, ' +
        'sospechar primero de SUPABASE_AUTH_REF (debe matchear el host que usó LA APP ' +
        'para NEXT_PUBLIC_SUPABASE_URL al buildear, no el host que usa k6 para llegar a Supabase).',
    );
  }

  // Catálogo biologicalSex — requerido por patient.create.
  const catalog = trpcQuery(
    'catalog.list',
    { catalog: 'biologicalSex', activeOnly: true },
    headers,
    { name: 'setup:catalog.biologicalSex', phase: 'setup' },
  );
  const biologicalSexId =
    catalog.ok && Array.isArray(catalog.data) && catalog.data[0] ? catalog.data[0].id : null;
  if (!biologicalSexId) {
    throw new Error(
      '[setup] catalog.list("biologicalSex") no devolvió filas activas. Sembrar ' +
        'el catálogo base (npm run db:seed) antes de correr esta suite.',
    );
  }

  // Episodio hospitalario activo — requerido por flujos 2/3/5 (evolución,
  // signos vitales, indicaciones). Si no hay ninguno sembrado, esos flujos
  // se omiten (ver lib/flows.js) — no rompe la corrida completa por esto,
  // porque no es un prerrequisito de los flujos 1/4/6.
  let sampleEpisodioId = null;
  let samplePatientId = null;
  const episodios = trpcQuery(
    'eceEpisodioHospitalario.list',
    { incluirCerrados: false, limit: 1 },
    headers,
    { name: 'setup:episodio.list', phase: 'setup' },
  );
  if (episodios.ok && Array.isArray(episodios.data) && episodios.data[0]) {
    sampleEpisodioId = episodios.data[0].id || null;
    samplePatientId = episodios.data[0].pacienteId || episodios.data[0].patientId || null;
  }
  if (!sampleEpisodioId) {
    console.warn(
      '[setup] No hay episodios hospitalarios activos sembrados — los flujos ' +
        '2 (Evolución Médica), 3 (Signos Vitales) y 5 (Indicaciones) se van a ' +
        'omitir en esta corrida. Sembrar con: npm run -w @his/database ' +
        'db:seed:demo-hospitalario',
    );
  }

  return {
    headers,
    biologicalSexId,
    sampleEpisodioId,
    samplePatientId,
    physicianUserId: session.userId, // id del usuario logueado (session.user.id de Supabase)
  };
}
