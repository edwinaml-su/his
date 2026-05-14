-- =============================================================================
-- HIS SQL 42 — Beta.15 Alerts/Notifications: outbox + RLS + indexes + guards
--
-- Acompañante de la migración Prisma del spike US.B15.1.1 (PR feat/beta15-spike-domain-event).
-- La migración Prisma crea las 4 tablas (DomainEvent, Notification,
-- UserNotificationPreference, RoleNotificationDefault) + 3 enums. Este archivo
-- añade lo que Prisma NO declara: partial indexes, CHECK custom, schema
-- 'notifications' para funciones SECURITY DEFINER, RLS policies, trigger guard
-- del recipient en Notification, función de purga.
--
-- NO incluye:
--   - notifications.process_outbox_batch() y cron.schedule() del poller
--     → depende de @SRE habilitando pg_cron + pg_net (SRE review §S1).
--     Se añade en SQL 44 separado cuando esas extensiones estén live.
--
-- Idempotente: DO $$ guards, CREATE OR REPLACE, DROP POLICY IF EXISTS,
-- CREATE SCHEMA IF NOT EXISTS, etc.
--
-- Referencias:
--   - docs/blueprints/beta15_notifications.md §4 §6 §7
--   - docs/blueprints/beta15_notifications_dba_review.md §S2 §S4 §S5
--   - docs/adr/0008-beta15-notifications-outbox.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema dedicado para funciones SECURITY DEFINER (aislamiento de privilegios).
--    Las TABLAS viven en public (multi-schema friction no justificada).
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS notifications;
GRANT USAGE ON SCHEMA notifications TO authenticated, service_role;
COMMENT ON SCHEMA notifications IS
  'Beta.15 — funciones SECURITY DEFINER del outbox/dispatcher. Tablas viven en public.';

-- -----------------------------------------------------------------------------
-- 2. DomainEvent: partial index + CHECK + autovacuum tuning
-- -----------------------------------------------------------------------------

-- Partial index usado por el poller (notifications.process_outbox_batch).
-- Selectividad alta: en steady state hay 0-100 rows con publishedAt IS NULL.
CREATE INDEX IF NOT EXISTS ix_domain_event_unpublished
  ON public."DomainEvent" ("occurredAt" ASC)
  WHERE "publishedAt" IS NULL AND attempts < 6;

-- Defensa BD: payload DEBE ser objeto JSON (no array/scalar). Detecta inserts
-- erróneos defensivamente. La validación canónica vive en emitDomainEvent (Zod).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'domain_event_payload_is_object_chk'
  ) THEN
    ALTER TABLE public."DomainEvent"
      ADD CONSTRAINT domain_event_payload_is_object_chk
      CHECK (jsonb_typeof(payload) = 'object');
  END IF;
END $$;

-- Autovacuum más agresivo: la tabla recibe updates frecuentes en attempts y
-- publishedAt (dispatcher tras cada tick) — mantener el partial index limpio.
ALTER TABLE public."DomainEvent" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

-- -----------------------------------------------------------------------------
-- 3. Notification: partial index para badge unread + autovacuum + fillfactor
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_notification_unread_per_user
  ON public."Notification" ("recipientUserId")
  WHERE status IN ('PENDING', 'SENT');

ALTER TABLE public."Notification" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05,
  fillfactor = 80
);

-- -----------------------------------------------------------------------------
-- 4. Trigger guard: recipient sólo puede marcar su notif como READ
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_notification_recipient_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- service_role bypasea esta validación (es el dispatcher actualizando status).
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Recipient sólo puede modificar status (SENT→READ) y readAt.
  IF (OLD."recipientUserId" <> NEW."recipientUserId")
     OR (OLD."organizationId" <> NEW."organizationId")
     OR (OLD."subject" IS DISTINCT FROM NEW."subject")
     OR (OLD."body" IS DISTINCT FROM NEW."body")
     OR (OLD.channel <> NEW.channel)
     OR (OLD.severity <> NEW.severity)
     OR (OLD."eventId" <> NEW."eventId")
  THEN
    RAISE EXCEPTION 'Recipient may only mark notification as READ'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Transición de status permitida: {SENT, DELIVERED} → READ.
  IF NOT (OLD.status IN ('SENT','DELIVERED') AND NEW.status = 'READ') THEN
    RAISE EXCEPTION 'Invalid status transition by recipient: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_recipient_guard ON public."Notification";
CREATE TRIGGER trg_notification_recipient_guard
  BEFORE UPDATE ON public."Notification"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notification_recipient_update_guard();

-- -----------------------------------------------------------------------------
-- 5. Purga de notificaciones leídas > 90 días (AuditLog permanece intacto)
--    Función pura; el cron.schedule() lo añade @SRE en SQL 44.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notifications.purge_read_after_90d()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public."Notification"
   WHERE status = 'READ'
     AND "readAt" < (NOW() - INTERVAL '90 days');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'notifications.purge_read_after_90d: deleted % rows', v_deleted;
  RETURN v_deleted;
EXCEPTION
  WHEN OTHERS THEN
    INSERT INTO audit."AuditLog" (action, entity, justification, "occurredAt")
    VALUES ('SYSTEM_ERROR'::"AuditAction", 'Notification',
            format('purge_read_after_90d SQLSTATE=%s msg=%s', SQLSTATE, SQLERRM),
            NOW());
    RAISE WARNING 'purge_read_after_90d failed: % %', SQLSTATE, SQLERRM;
    RETURN -1;
END;
$$;

REVOKE ALL ON FUNCTION notifications.purge_read_after_90d() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notifications.purge_read_after_90d() TO postgres;

-- -----------------------------------------------------------------------------
-- 6. RLS — DomainEvent
-- -----------------------------------------------------------------------------

ALTER TABLE public."DomainEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DomainEvent" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS domain_event_tenant_select ON public."DomainEvent";
CREATE POLICY domain_event_tenant_select
  ON public."DomainEvent"
  FOR SELECT
  TO authenticated
  USING ("organizationId" = current_org_id());

DROP POLICY IF EXISTS domain_event_tenant_insert ON public."DomainEvent";
CREATE POLICY domain_event_tenant_insert
  ON public."DomainEvent"
  FOR INSERT
  TO authenticated
  WITH CHECK ("organizationId" = current_org_id());

DROP POLICY IF EXISTS domain_event_service_update ON public."DomainEvent";
CREATE POLICY domain_event_service_update
  ON public."DomainEvent"
  FOR UPDATE
  TO service_role
  USING (true) WITH CHECK (true);

-- DELETE: sin policy → bloqueado para authenticated y service_role no-owner.

-- -----------------------------------------------------------------------------
-- 7. RLS — Notification
-- -----------------------------------------------------------------------------

ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Notification" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_recipient_select ON public."Notification";
CREATE POLICY notification_recipient_select
  ON public."Notification"
  FOR SELECT
  TO authenticated
  USING (
    "recipientUserId" = current_user_id()
    AND "organizationId" = current_org_id()
  );

DROP POLICY IF EXISTS notification_service_insert ON public."Notification";
CREATE POLICY notification_service_insert
  ON public."Notification"
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- UPDATE para authenticated: el recipient marca status=READ. El trigger guard
-- (fn_notification_recipient_update_guard) enforce que sólo cambie status+readAt.
DROP POLICY IF EXISTS notification_recipient_mark_read ON public."Notification";
CREATE POLICY notification_recipient_mark_read
  ON public."Notification"
  FOR UPDATE
  TO authenticated
  USING ("recipientUserId" = current_user_id())
  WITH CHECK ("recipientUserId" = current_user_id());

DROP POLICY IF EXISTS notification_service_update ON public."Notification";
CREATE POLICY notification_service_update
  ON public."Notification"
  FOR UPDATE
  TO service_role
  USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 8. RLS — UserNotificationPreference (self-only)
-- -----------------------------------------------------------------------------

ALTER TABLE public."UserNotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UserNotificationPreference" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notif_pref_self ON public."UserNotificationPreference";
CREATE POLICY user_notif_pref_self
  ON public."UserNotificationPreference"
  FOR ALL
  TO authenticated
  USING ("userId" = current_user_id())
  WITH CHECK ("userId" = current_user_id());

-- service_role bypasea por default (es el dispatcher leyendo prefs).

-- -----------------------------------------------------------------------------
-- 9. RLS — RoleNotificationDefault (read público dentro de auth; write servicio)
-- -----------------------------------------------------------------------------

ALTER TABLE public."RoleNotificationDefault" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_notif_default_read ON public."RoleNotificationDefault";
CREATE POLICY role_notif_default_read
  ON public."RoleNotificationDefault"
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS role_notif_default_service_write ON public."RoleNotificationDefault";
CREATE POLICY role_notif_default_service_write
  ON public."RoleNotificationDefault"
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Verificación post-apply (queries de comprobación)
-- =============================================================================
-- SELECT count(*) FROM pg_policies
--   WHERE schemaname='public'
--     AND tablename IN ('DomainEvent','Notification','UserNotificationPreference','RoleNotificationDefault');
-- Esperado: >= 9 (3 DomainEvent + 4 Notification + 1 prefs + 2 defaults).
--
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--   WHERE relname IN ('DomainEvent','Notification','UserNotificationPreference','RoleNotificationDefault');
-- Esperado: relrowsecurity=true en las 4; relforcerowsecurity=true en 3 (excepto RoleNotificationDefault).
--
-- SELECT proname, proconfig FROM pg_proc
--   WHERE proname IN ('fn_notification_recipient_update_guard','purge_read_after_90d');
-- Esperado: ambas con proconfig conteniendo 'search_path='.
--
-- SELECT indexname FROM pg_indexes
--   WHERE schemaname='public'
--     AND indexname IN ('ix_domain_event_unpublished','ix_notification_unread_per_user');
-- Esperado: 2 filas.
-- =============================================================================
