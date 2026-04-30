/**
 * Sentry — inicialización en el navegador (Client Components).
 *
 * Reglas estrictas (cumplimiento HIPAA-equivalente, TDR §29.4):
 *  - NUNCA enviar PHI/PII (nombre paciente, DUI, diagnósticos, número HCE).
 *  - URLs con identificadores de paciente se redactan antes de enviar.
 *  - Sampling configurable vía env para control de costos.
 */
import * as Sentry from '@sentry/nextjs';

import { scrubEvent } from './sentry.shared';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_APP_VERSION;

const tracesSampleRate = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.1');
const replaysSessionSampleRate = Number(process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION ?? '0');
const replaysErrorSampleRate = Number(process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ERROR ?? '0');

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate,
    replaysSessionSampleRate,
    replaysOnErrorSampleRate: replaysErrorSampleRate,
    // En MVP no usamos Replay para evitar capturar PHI accidentalmente.
    // Se habilitará selectivamente en Fase 2+ con masking estricto.
    integrations: [],
    sendDefaultPii: false,
    // Hook de scrubbing — se ejecuta antes de enviar cualquier evento.
    beforeSend: scrubEvent,
    beforeBreadcrumb(breadcrumb) {
      // Scrub URLs en navegación
      if (breadcrumb.category === 'navigation' && breadcrumb.data?.to) {
        breadcrumb.data.to = redactUrl(String(breadcrumb.data.to));
      }
      if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
        if (breadcrumb.data?.url) {
          breadcrumb.data.url = redactUrl(String(breadcrumb.data.url));
        }
      }
      return breadcrumb;
    },
    ignoreErrors: [
      // Ruido típico que no aporta valor
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
    ],
  });
}

function redactUrl(url: string): string {
  // Redacta IDs UUID y números potencialmente sensibles en path
  return url.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');
}
