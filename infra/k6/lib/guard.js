// lib/guard.js — Guard anti-producción (REQ-HIS-PERF-001 §11/§12).
//
// Aborta la ejecución de k6 si BASE_URL no es localhost. Es la última línea
// de defensa contra dirigir carga a producción (his.complejoavante.com /
// his-avante.vercel.app) o a un preview de Vercel — infraestructura
// compartida de terceros cuyo ToS exige aprobación previa para load testing
// (instrucción explícita de Edwin Martínez, 2026-08-17).
//
// Se invoca desde lib/config.js para que TODO scenario quede protegido sin
// tener que tocar cada archivo — incluidos los 01-06 preexistentes. Cada
// scenario A-F de este REQ además la llama explícitamente al inicio como
// segunda capa (defensa en profundidad, criterio de aceptación §12).
//
// Lanza un Error si el target no es válido. En k6, un throw durante la fase
// de init (código a nivel de módulo, fuera de export default) aborta la
// corrida ANTES de levantar ningún VU — no se genera tráfico.

// Hosts de PRODUCCIÓN: bloqueo absoluto, SIN override posible. Ni siquiera
// `PERF_ALLOW_HOST` los habilita — es deliberado: la variable de autorización
// existe para previews, y un dedazo escribiendo el dominio de producción ahí
// no debe poder dirigir carga a un hospital en operación.
const PROD_HOST_PATTERNS = [
  /^his\.complejoavante\.com$/i,
  /^his-avante\.vercel\.app$/i,
  /^his-avante-edwinaml-sus-projects\.vercel\.app$/i, // alias del project root de production
  /\.supabase\.co$/i, // por si alguien apunta BASE_URL directo al proyecto Supabase de prod.
];

const LOCAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^\[::1\]$/,
  /^0\.0\.0\.0$/,
  /^host\.docker\.internal$/i, // caso: k6 corre en un contenedor y la app en el host.
];

/**
 * assertLocalTarget — valida que `rawUrl` apunte a localhost.
 * @param {string} rawUrl - normalmente __ENV.BASE_URL
 * @returns {string} el hostname validado
 * @throws {Error} si rawUrl es inválida, de producción, o no-local
 */
/**
 * extractHostname — parser mínimo de hostname, SIN el constructor `URL`.
 * k6 (goja) no expone `URL` como global en todas las versiones/builds (visto
 * en k6 v2.2.0 vía Docker: "ReferenceError: URL is not defined") — evitamos
 * la dependencia en vez de asumir disponibilidad.
 */
function extractHostname(rawUrl) {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(rawUrl);
  if (!match) return null;
  return match[1].toLowerCase();
}

export function assertLocalTarget(rawUrl) {
  if (!rawUrl) {
    throw new Error(
      '[guard-anti-produccion] BASE_URL no está definida. Esta suite solo corre contra ' +
        'localhost — pasala explícitamente: k6 run -e BASE_URL=http://localhost:3000 ...',
    );
  }

  const hostname = extractHostname(rawUrl);
  if (!hostname) {
    throw new Error(`[guard-anti-produccion] BASE_URL inválida: "${rawUrl}"`);
  }

  const isProd = PROD_HOST_PATTERNS.some((re) => re.test(hostname));
  if (isProd) {
    throw new Error(
      `[guard-anti-produccion] BASE_URL="${rawUrl}" apunta a un host de PRODUCCIÓN o PREVIEW ` +
        `("${hostname}"). REQ-HIS-PERF-001 §11 prohíbe explícitamente dirigir carga ahí. Abortando.`,
    );
  }

  const isLocal = LOCAL_HOST_PATTERNS.some((re) => re.test(hostname));
  if (isLocal) return hostname;

  // Preview de Vercel explícitamente autorizado (2026-08-18): correr contra
  // localhost mide la laptop, no la infraestructura desplegada — crítica
  // correcta de Edwin. Un deployment de PREVIEW corre sobre el mismo runtime,
  // región y límites que producción, así que medirlo sí responde la pregunta
  // de capacidad, sin tocar datos reales.
  //
  // Requiere DOS variables, y ambas son deliberadas: el host debe declararse
  // una por una (no hay comodín `*.vercel.app`), y debe venir el token de
  // Protection Bypass — sin él Vercel devuelve su challenge y la corrida
  // mediría el WAF en vez de la app.
  const allowed = (__ENV.PERF_ALLOW_HOST || '').trim().toLowerCase();
  if (allowed && allowed === hostname) {
    if (!(__ENV.VERCEL_BYPASS_TOKEN || '').trim()) {
      throw new Error(
        `[guard-anti-produccion] PERF_ALLOW_HOST="${hostname}" autorizado, pero falta ` +
          'VERCEL_BYPASS_TOKEN. Sin el token, Vercel responde 429 con ' +
          'x-vercel-mitigated:challenge a todo cliente no-navegador y la corrida mediría ' +
          'la mitigación, no la aplicación. Abortando para no producir números falsos.',
      );
    }
    return hostname;
  }

  throw new Error(
    `[guard-anti-produccion] BASE_URL="${rawUrl}" (host "${hostname}") no es localhost ni ` +
      'está autorizado. Para correr contra un preview de Vercel, declaralo explícitamente: ' +
      `PERF_ALLOW_HOST=${hostname} VERCEL_BYPASS_TOKEN=<token>. Los dominios de PRODUCCIÓN ` +
      'están bloqueados de forma absoluta y esa variable NO los habilita.',
  );
}
