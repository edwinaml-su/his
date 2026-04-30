/**
 * Sentry — inicialización en runtime Edge (middleware.ts, Edge route handlers).
 * Sample rate más bajo: el edge ve mucho tráfico de baja señal.
 */
import * as Sentry from '@sentry/nextjs';

import { scrubEvent } from './sentry.shared';

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
const release = process.env.SENTRY_RELEASE ?? process.env.APP_VERSION;
const tracesSampleRate = Number(process.env.SENTRY_EDGE_TRACES_SAMPLE_RATE ?? '0.02');

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
