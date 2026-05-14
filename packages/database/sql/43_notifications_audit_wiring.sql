-- =============================================================================
-- HIS SQL 43 — Beta.15: audit triggers para las 4 tablas nuevas
--
-- Extiende el patrón de SQL 22 (audit_triggers_phase2) aplicando
-- `audit.fn_audit_row()` AFTER INSERT/UPDATE/DELETE a:
--   - DomainEvent
--   - Notification
--   - UserNotificationPreference
--   - RoleNotificationDefault
--
-- NOTA — hash chain (DBA review §S8):
--   Recomendación @DBA: excluir 'Notification' de la hash chain (write
--   amplification: ~8k AuditLog rows/día sólo de notif × serialización del
--   prevHash chain).
--
--   Implementación pendiente como follow-up: modificar audit.fn_audit_log_chain
--   para early-return cuando entity = 'Notification' (escribir el row sin
--   prevHash/signatureHash). Beta.15 acepta el costo inicial; mide y optimiza.
--
-- Idempotente: DROP TRIGGER IF EXISTS antes de CREATE.
-- =============================================================================

DO $$
DECLARE
  audited_beta15 text[] := ARRAY[
    -- Beta.15 — Alerts / Notifications
    'DomainEvent',
    'Notification',
    'UserNotificationPreference',
    'RoleNotificationDefault'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY audited_beta15 LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_'||t, t);
    EXECUTE format(
      'CREATE TRIGGER %I
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row()',
      'trg_audit_'||t, t
    );
  END LOOP;
END$$;

-- =============================================================================
-- Verificación post-apply:
--   SELECT tgname, tgrelid::regclass FROM pg_trigger
--     WHERE NOT tgisinternal AND tgname LIKE 'trg_audit_%'
--       AND tgrelid::regclass::text IN ('"DomainEvent"','"Notification"',
--           '"UserNotificationPreference"','"RoleNotificationDefault"');
-- Esperado: 4 rows.
-- =============================================================================
