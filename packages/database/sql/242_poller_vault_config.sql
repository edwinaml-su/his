-- =============================================================================
-- HIS SQL 242 — Poller del outbox: configuración vía Vault (fix del runbook
-- Beta.15).
--
-- ⚠️ APLICADO a prod 2026-09-15 vía MCP (poller_vault_config_242) — NO
-- re-aplicar.
--
-- Por qué existe: el diseño original (SQL 44) leía la URL del dispatcher y el
-- service_role key de dos GUCs seteados con `ALTER DATABASE ... SET app.*`.
-- En Supabase gestionado ese comando falla con `42501 permission denied to
-- set parameter` PARA TODOS los roles disponibles — incluido el SQL Editor
-- del Dashboard (verificado 2026-09-15 por Edwin y por MCP; `ALTER ROLE`
-- idem). El runbook beta15_poller_activation.md §3 es INEJECUTABLE tal como
-- está escrito.
--
-- Solución: mismo patrón que el proyecto ya usa para secretos (Vault,
-- precedente PortalAccount.mfaSecret / get_portal_mfa_secret):
--   - URL del dispatcher: constante del proyecto (no es secreto) con
--     override opcional en Vault (`notifications_dispatch_url`).
--   - service_role key: SOLO desde Vault, secreto
--     `notifications_dispatch_service_key`. NUNCA en este SQL ni en GUCs.
--   - Fallback a los GUCs originales por si algún entorno self-hosted sí
--     los soporta (docs/runbooks/db-reconstruccion-fuera-de-supabase.md).
--
-- Guard anti-quema: si la KEY no está configurada, la función hace RETURN 0
-- SIN tocar los eventos (igual que el guard de URL original) — el poller
-- marca publishedAt de forma optimista al despachar, así que despachar con
-- Bearer vacío contra la Edge Function (verify_jwt) quemaría los eventos con
-- un 401 silencioso. Con este guard, el backlog espera intacto hasta que el
-- secreto exista.
--
-- Cómo configurar (paso ÚNICO de operador, sin permisos especiales):
--   Dashboard → Integrations → Vault → Secrets → Add new secret:
--     name  = notifications_dispatch_service_key
--     value = <service_role key>  (Settings → API Keys → service_role → Reveal)
--   (equivalente SQL: SELECT vault.create_secret('<key>',
--    'notifications_dispatch_service_key');)
-- =============================================================================

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
  -- SQL 242: Vault primero, GUC legacy después, constante del proyecto al final.
  SELECT decrypted_secret INTO v_dispatch_url
    FROM vault.decrypted_secrets WHERE name = 'notifications_dispatch_url' LIMIT 1;
  IF v_dispatch_url IS NULL OR length(v_dispatch_url) = 0 THEN
    v_dispatch_url := current_setting('app.notifications_dispatch_url', true);
  END IF;
  IF v_dispatch_url IS NULL OR length(v_dispatch_url) = 0 THEN
    v_dispatch_url := 'https://ejacvsgbewcerxtjtwto.supabase.co/functions/v1/notifications-dispatch';
  END IF;

  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'notifications_dispatch_service_key' LIMIT 1;
  IF v_service_key IS NULL OR length(v_service_key) = 0 THEN
    v_service_key := current_setting('app.service_role_key', true);
  END IF;

  IF v_service_key IS NULL OR length(v_service_key) = 0 THEN
    -- Guard anti-quema: sin key, la Edge Function (verify_jwt) devolvería 401
    -- y el despacho optimista marcaría publishedAt sin notificación real.
    RAISE WARNING 'process_outbox_batch: secreto notifications_dispatch_service_key no configurado en Vault — skipping batch (backlog intacto).';
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
      SELECT net.http_post(
        url     := v_dispatch_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
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
  'Beta.15 + SQL 242 — poller del outbox. Config vía Vault (notifications_dispatch_service_key; URL constante con override). Llama Edge Function notifications-dispatch vía pg_net. SKIP LOCKED + backoff exponencial. Invocada por pg_cron cada minuto.';
