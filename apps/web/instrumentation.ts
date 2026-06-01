/**
 * instrumentation.ts — Next.js 14 hook de instrumentación.
 *
 * Este archivo es invocado automáticamente por el runtime ANTES de servir
 * cualquier request. Inicializa Sentry para Node.js y Edge según corresponda.
 *
 * Refs:
 *  - https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *  - https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
