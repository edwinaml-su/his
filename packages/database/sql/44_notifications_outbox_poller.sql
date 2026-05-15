-- =============================================================================
-- HIS SQL 44 — Beta.15 Outbox Poller (pg_cron + pg_net)
--
-- US.B15.1.3. Decisión §5.1 vinculante 2026-05-14: pg_cron + pg_net (NO Inngest,
-- NO Vercel Cron). Complemento de SQL 42 (outbox + RLS) y SQL 43 (audit wiring).
--
-- REQUIERE habilitar previamente (Supabase Dashboard → Database → Extensions):
--   - pg_cron (v1.6.4+) — disponible pero NO instalada al cierre 2026-05-15
--   - pg_net  (v0.20.0+) — disponible pero NO instalada al cierre 2026-05-15
--
-- REQUIERE GUC configurado (via ALTER DATABASE, ver activation runbook):
--   - app.notifications_dispatch_url = 'https://<project>.supabase.co/functions/v1/notifications-dispatch'
--   - app.service_role_key           = '<service_role_jwt>'  (NUNCA en este SQL)
--
-- Idempotente: CREATE OR REPLACE, CREATE EXTENSION IF NOT EXISTS, DO $$ guards.
--
-- Referencias:
--   - docs/blueprints/beta15_poller_activation.md (activation runbook)
--   - docs/blueprints/beta15_notifications_sre_review.md §S1 §S2 §S5
--   - docs/blueprints/beta15_notifications_dba_review.md §S4 §S5
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensions (idempotente). Falla si el rol que aplica este SQL NO tiene
--    SUPERUSER. En Supabase Dashboard → Extensions Edwin las habilita antes.
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1. Columnas auxiliares en DomainEvent — añadidas defensivamente si faltan.
--    schema.prisma ya declara `lastError`. lastAttemptAt y lastNetRequestId son
--    operacionales del poller; sync a Prisma va en PR separado (no afecta tipos).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'DomainEvent'
       AND column_name = 'lastAttemptAt'
  ) THEN
    ALTER TABLE public."DomainEvent" ADD COLUMN "lastAttemptAt" TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'DomainEvent'
       AND column_name = 'lastNetRequestId'
  ) THEN
    ALTER TABLE public."DomainEvent" ADD COLUMN "lastNetRequestId" BIGINT;
  END IF;
END $$;

COMMENT ON COLUMN public."DomainEvent"."lastAttemptAt" IS
  'Beta.15 — timestamp del último intento del poller (usado para backoff exponencial).';
COMMENT ON COLUMN public."DomainEvent"."lastNetRequestId" IS
  'Beta.15 — request_id devuelto por net.http_post (correlación con net._http_response).';

-- -----------------------------------------------------------------------------
-- 2. notifications.process_outbox_batch(p_limit) — poller principal.
--
--    - SECURITY DEFINER + search_path = '' (defensa search_path injection).
--    - FOR UPDATE SKIP LOCKED → concurrency safe (varios workers / reentradas).
--    - Backoff exponencial: 30s × 2^attempts (≈30s, 1m, 2m, 4m, 8m, 16m).
--      Como pg_cron min interval = 1 min, "30s después de fallo" se aproxima a
--      "1 min después" en la práctica.
--    - EXCEPTION handler incrementa attempts y persiste lastError (truncado).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notifications.process_outbox_batch(p_limit INT DEFAULT 50)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id        UUID;
  v_event_type      TEXT;
  v_payload         JSONB;
  v_organization_id UUID;
  v_processed       INT  := 0;
  v_request_id      BIGINT;
  v_dispatch_url    TEXT;
  v_service_key     TEXT;
BEGIN
  -- GUCs configurables vía ALTER DATABASE (ver activation runbook).
  v_dispatch_url := current_setting('app.notifications_dispatch_url', true);
  v_service_key  := current_setting('app.service_role_key', true);

  IF v_dispatch_url IS NULL OR length(v_dispatch_url) = 0 THEN
    RAISE WARNING 'process_outbox_batch: app.notifications_dispatch_url no configurada — skipping batch.';
    RETURN 0;
  END IF;

  FOR v_event_id, v_event_type, v_payload, v_organization_id IN
    SELECT id, "eventType", payload, "organizationId"
      FROM public."DomainEvent"
     WHERE "publishedAt" IS NULL
       AND attempts < 6
       AND ("lastAttemptAt" IS NULL
            OR "lastAttemptAt" < now() - (interval '30 seconds' * power(2, attempts)))
     ORDER BY "occurredAt" ASC
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- pg_net encola la llamada y retorna request_id (async). La Edge Function
      -- es responsable de marcar Notification.status final. Aquí asumimos entrega
      -- optimista (publishedAt = now). Si net.http_post falla síncronamente, el
      -- EXCEPTION handler incrementa attempts en su lugar.
      SELECT net.http_post(
        url     := v_dispatch_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(v_service_key, '')
        ),
        body    := jsonb_build_object(
          'eventId',        v_event_id,
          'eventType',      v_event_type,
          'organizationId', v_organization_id,
          'payload',        v_payload
        ),
        timeout_milliseconds := 8000
      ) INTO v_request_id;

      UPDATE public."DomainEvent"
         SET "publishedAt"      = now(),
             "lastAttemptAt"    = now(),
             "lastNetRequestId" = v_request_id,
             attempts           = attempts + 1
       WHERE id = v_event_id;

      v_processed := v_processed + 1;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public."DomainEvent"
         SET attempts        = attempts + 1,
             "lastAttemptAt" = now(),
             "lastError"     = left(SQLERRM, 2000)
       WHERE id = v_event_id;

      RAISE WARNING 'process_outbox_batch: event % failed: %', v_event_id, SQLERRM;
    END;
  END LOOP;

  IF v_processed > 0 THEN
    RAISE NOTICE 'process_outbox_batch: dispatched % events', v_processed;
  END IF;

  RETURN v_processed;
END;
$$;

COMMENT ON FUNCTION notifications.process_outbox_batch(INT) IS
  'Beta.15 — poller del outbox. Llama Edge Function notifications-dispatch vía pg_net. SKIP LOCKED + backoff exponencial. Invocada por pg_cron cada minuto.';

REVOKE EXECUTE ON FUNCTION notifications.process_outbox_batch(INT) FROM PUBLIC, authenticated;
GRANT  EXECUTE ON FUNCTION notifications.process_outbox_batch(INT) TO service_role, postgres;

-- -----------------------------------------------------------------------------
-- 3. pg_cron schedule — cada 1 minuto.
--
--    Limitación: pg_cron min interval = 1 min. La Decisión §5.1 mencionaba un
--    objetivo de 30s; con cron nativo esto NO es posible. Workaround documentado
--    en docs/blueprints/beta15_poller_activation.md §Latencia:
--      a) un único job */1 * * * * con batch grande (50) — implementado aquí.
--      b) Wave 2 (post-MVP): evaluar Inngest si P95 dispatch latency > 90s.
--
--    Idempotente vía cron.schedule devuelve job_id silencioso si ya existe;
--    para ser explícitos, UNSCHEDULE previo si el jobname está duplicado.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  -- Evita duplicar el job si este SQL se aplica más de una vez.
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'notifications-poll-outbox'
  ) THEN
    PERFORM cron.unschedule('notifications-poll-outbox');
  END IF;

  PERFORM cron.schedule(
    'notifications-poll-outbox',
    '*/1 * * * *',
    $cron$SELECT notifications.process_outbox_batch(50);$cron$
  );
END $$;

-- -----------------------------------------------------------------------------
-- 4. Métrica dead-letter (queries manuales hasta tener Grafana).
--
--    -- Eventos atascados (DLQ):
--    SELECT count(*) FROM public."DomainEvent"
--     WHERE attempts >= 6 AND "publishedAt" IS NULL;
--
--    -- Top errores recientes:
--    SELECT "eventType", "lastError", count(*)
--      FROM public."DomainEvent"
--     WHERE "lastError" IS NOT NULL
--       AND "lastAttemptAt" > now() - interval '1 hour'
--     GROUP BY 1, 2
--     ORDER BY 3 DESC
--     LIMIT 20;
--
--    -- Backlog actual (esperando publish):
--    SELECT count(*) FROM public."DomainEvent" WHERE "publishedAt" IS NULL;
-- =============================================================================
-- Verificación post-apply (queries de comprobación)
-- =============================================================================
-- SELECT proname FROM pg_proc
--  WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='notifications')
--    AND proname = 'process_outbox_batch';
-- Esperado: 1 fila.
--
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'notifications-poll-outbox';
-- Esperado: jobname='notifications-poll-outbox', schedule='*/1 * * * *', active=true.
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='DomainEvent'
--    AND column_name IN ('lastAttemptAt','lastNetRequestId','lastError');
-- Esperado: 3 filas.
-- =============================================================================
