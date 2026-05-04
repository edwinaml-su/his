/**
 * Sentry — utilidades compartidas entre client/server/edge.
 * Centraliza el scrubbing de PII/PHI conforme TDR §29.4 + §29.8.
 *
 * Política:
 *  - Nunca debe llegar a Sentry: nombre, apellido, DUI, fecha de nacimiento,
 *    dirección, email, teléfono, número de expediente clínico, diagnóstico (ICD),
 *    notas clínicas, resultados de laboratorio, identificadores de paciente.
 *  - Sí pueden llegar: stack traces, URLs (sin IDs), tags de tenant, código de error,
 *    role del usuario (no su email), país.
 */
import type { Event, EventHint, SamplingContext } from '@sentry/types';

const PII_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /\b(dui|nit|nuip|cui|cedula|passport)\b/i,
  /\b(first_?name|last_?name|full_?name|birth|dob|address|phone|email)\b/i,
  /\b(diagnosis|icd|hcm_id|patient_id|mrn|note|narrative)\b/i,
  /\b(allergy|medication|prescription|lab_?result)\b/i,
];

const REDACTED = '[REDACTED]';

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((re) => re.test(key));
}

function deepScrub<T>(input: T, depth = 0): T {
  if (depth > 8 || input == null) return input;
  if (Array.isArray(input)) {
    return input.map((v) => deepScrub(v, depth + 1)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = isPiiKey(k) ? REDACTED : deepScrub(v, depth + 1);
    }
    return out as unknown as T;
  }
  return input;
}

/**
 * Hook `beforeSend` de Sentry — scrubbea cualquier campo libre que pueda
 * arrastrar PHI antes de salir del proceso.
 */
export function scrubEvent(event: Event, _hint?: EventHint): Event | null {
  // Cabeceras
  if (event.request?.headers) {
    event.request.headers = deepScrub(event.request.headers);
  }
  // Query / body
  if (event.request?.data) {
    event.request.data = deepScrub(event.request.data);
  }
  if (event.request?.query_string && typeof event.request.query_string === 'string') {
    // Redacta valores de query params (ej. ?dui=... )
    event.request.query_string = event.request.query_string.replace(
      /([?&])([^=&]+)=([^&]*)/g,
      (_match, sep: string, key: string, value: string) =>
        isPiiKey(key) ? `${sep}${key}=${REDACTED}` : `${sep}${key}=${value}`,
    );
  }
  // URL: redacta UUIDs y secuencias largas de dígitos
  if (event.request?.url) {
    event.request.url = event.request.url
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
      .replace(/\b\d{6,}\b/g, '<num>');
  }
  // Extra / contexts / tags
  if (event.extra) event.extra = deepScrub(event.extra);
  if (event.contexts) event.contexts = deepScrub(event.contexts);
  // User: solo conservar id (UUID) y role; nunca email/nombre.
  if (event.user) {
    event.user = {
      id: typeof event.user.id === 'string' ? event.user.id : undefined,
      // role/tenant los seteamos como tags, no como campos PII
    };
  }
  return event;
}

/* -------------------------------------------------------------------------- */
/*  Sampling rates (US-8.2)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Tasas de sampling de transactions por categoría de ruta (Sentry tracing).
 *
 *  - Healthcheck / static: 0.0 — alto volumen, poca señal, ahorra cuota.
 *  - tRPC mutations:       1.0 — escrituras, cualquier degradación importa.
 *  - tRPC queries:         0.1 — alto volumen, muestreo suficiente para p95.
 *  - resto de rutas:       0.5 — default razonable balance señal/ruido.
 */
export const SENTRY_SAMPLE_RATES = {
  health: 0.0,
  staticAsset: 0.0,
  metrics: 0.0,
  trpcMutation: 1.0,
  trpcQuery: 0.1,
  default: 0.5,
} as const;

/** Profiling deshabilitado en MVP (Hobby plan no lo incluye / costo). */
export const SENTRY_PROFILES_SAMPLE_RATE = 0.0;

/**
 * Decide la tasa de sampling para una transaction basándose en su `op` y URL.
 * Diseñada para enchufarse a `Sentry.init({ tracesSampler })`.
 */
export function tracesSampler(samplingContext: SamplingContext): number {
  // 1) Honra inheritOrSampled cuando viene de upstream (mantén la decisión del padre).
  const parentSampled = samplingContext.parentSampled;
  if (typeof parentSampled === 'boolean') {
    return parentSampled ? 1.0 : 0.0;
  }

  // 2) Extrae info de transaction: nombre, op, attributes.
  const ctx = samplingContext.transactionContext as
    | {
        name?: string;
        op?: string;
        data?: Record<string, unknown>;
        attributes?: Record<string, unknown>;
      }
    | undefined;

  const name = (ctx?.name ?? '').toString();
  const op = (ctx?.op ?? '').toString();

  // Inferir URL desde data/attributes/request si aplica
  const reqUrl =
    (samplingContext as { request?: { url?: string } }).request?.url ??
    (ctx?.data?.url as string | undefined) ??
    (ctx?.attributes?.['http.url'] as string | undefined) ??
    (ctx?.attributes?.['http.target'] as string | undefined) ??
    name;

  const url = String(reqUrl ?? '');

  // 3) Rutas silenciadas
  if (url.includes('/api/health')) return SENTRY_SAMPLE_RATES.health;
  if (url.includes('/api/metrics')) return SENTRY_SAMPLE_RATES.metrics;
  if (url.includes('/_next/static') || url.match(/\.(js|css|map|woff2?|png|svg|ico)$/i)) {
    return SENTRY_SAMPLE_RATES.staticAsset;
  }

  // 4) tRPC: distinguir mutations vs queries.
  // Convención Next.js + tRPC: GET = query, POST = mutation. Y `transactionContext.attributes['http.method']`.
  if (url.includes('/api/trpc/')) {
    const method =
      (ctx?.attributes?.['http.method'] as string | undefined) ??
      (ctx?.data?.method as string | undefined) ??
      (op.includes('mutation') ? 'POST' : undefined);

    if (method && method.toUpperCase() === 'POST') return SENTRY_SAMPLE_RATES.trpcMutation;
    if (op.includes('mutation')) return SENTRY_SAMPLE_RATES.trpcMutation;
    return SENTRY_SAMPLE_RATES.trpcQuery;
  }

  // 5) Default
  return SENTRY_SAMPLE_RATES.default;
}

/**
 * Patrones de mensajes/errores ruidosos que NO deben llegar a Sentry.
 * Aplica como complemento a `ignoreErrors` para casos que dependen del mensaje
 * en runtime (ej. `NetworkError` cuando el browser está offline).
 */
const NOISY_ERROR_PATTERNS: RegExp[] = [
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i,
  /Non-Error promise rejection captured/i,
  /Failed to fetch$/i, // típico cuando el browser pierde conectividad transitoria
  /NetworkError when attempting to fetch resource/i,
  /Load failed$/i, // Safari offline
  /AbortError: The (operation|user) (was )?aborted/i,
  /The operation was aborted/i,
];

function eventLooksNoisy(event: Event): boolean {
  const msg = event.message ?? '';
  if (msg && NOISY_ERROR_PATTERNS.some((re) => re.test(msg))) return true;
  const exceptions = event.exception?.values ?? [];
  for (const ex of exceptions) {
    const exMsg = `${ex.type ?? ''}: ${ex.value ?? ''}`;
    if (NOISY_ERROR_PATTERNS.some((re) => re.test(exMsg))) return true;
  }
  return false;
}

/**
 * Variante de `scrubEvent` que además filtra (devuelve null) cuando el evento
 * matchea patrones de ruido conocido. Centraliza la política de drops para
 * client/server/edge configs.
 */
export function scrubAndFilterEvent(event: Event, hint?: EventHint): Event | null {
  if (eventLooksNoisy(event)) return null;
  return scrubEvent(event, hint);
}
