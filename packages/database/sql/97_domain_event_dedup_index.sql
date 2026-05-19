-- =============================================================================
-- SQL 97 — DomainEvent dedup partial UNIQUE INDEX
-- =============================================================================
--
-- Contexto: el outbox `DomainEvent` solo tiene PRIMARY KEY (id). Routers
-- que usan `ON CONFLICT DO NOTHING` esperando dedup de eventos duplicados,
-- pero como cada INSERT genera un UUID nuevo, la cláusula es no-op.
--
-- Fix: partial UNIQUE INDEX scoped a eventos NO publicados (pending en outbox).
-- Semántica: solo 1 evento pendiente por (organizationId, aggregateId, eventType).
-- Una vez el dispatcher Beta.15 marca `publishedAt IS NOT NULL`, el constraint
-- se relaja para permitir re-emisión del mismo evento más tarde.
--
-- NOTA: columnas en Prisma son camelCase quoted. Postgres preserva el casing
-- exacto cuando hay quotes — por eso el índice usa "organizationId" etc.
--
-- Casos de uso protegidos:
--   - medication-window.router.ts → emitWindowClosingAlerts (US.F2.6.52)
--   - farmacovigilancia.router.ts → notificaciones de recall (US.F2.6.56)
--   - bedside-stat.router.ts → activación STAT (US.F2.6.47)
--   - cualquier futuro emisor que use ON CONFLICT DO NOTHING en DomainEvent
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_event_pending_dedup
  ON public."DomainEvent" (
    "organizationId",
    "aggregateId",
    "eventType"
  )
  WHERE "publishedAt" IS NULL;

COMMENT ON INDEX public.uq_domain_event_pending_dedup IS
  'Outbox dedup — previene duplicado de eventos pending para mismo aggregate+type+org. Se relaja cuando el dispatcher publica el evento (publishedAt IS NOT NULL).';
