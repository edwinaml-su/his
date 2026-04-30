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
import type { Event, EventHint } from '@sentry/types';

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
