/**
 * Sentry — inicialización en runtime Node.js (Server Components, route handlers, Server Actions).
 *
 * En servidor el riesgo de PHI es MAYOR (queries, payloads de API, errores con datos del paciente).
 * El scrubbing es agresivo: cualquier propiedad cuyo nombre matchee una lista de PII se redacta.
 */
import * as Sentry from '@sentry/nextjs';

import { scrubEvent } from './sentry.shared';

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
const release = process.env.SENTRY_RELEASE ?? process.env.APP_VERSION;
const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.05');

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate,
    sendDefaultPii: false,
    // Excluye automáticamente errores conocidos de framework
    ignoreErrors: ['NEXT_NOT_FOUND', 'NEXT_REDIRECT'],
    // Scrubbing en servidor: más estricto que en cliente
    beforeSend: scrubEvent,
    beforeSendTransaction(transaction) {
      // No mandes transactions de healthchecks (ruido + costo)
      const txName = transaction.transaction ?? '';
      if (txName.includes('/api/health')) return null;
      return transaction;
    },
  });
}
