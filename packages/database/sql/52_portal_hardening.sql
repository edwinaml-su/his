-- =============================================================================
-- 52_portal_hardening.sql — RLS + indexes para el Portal del Paciente (Beta.20)
-- =============================================================================
-- Tablas: PortalAccount, PortalSession, PortalMagicLink, GuardianRelationship
--
-- RLS usa GUC app.current_portal_account (uuid del portal account autenticado).
-- La función current_portal_account() lee el GUC; SET LOCAL en withPortalContext.
--
-- Aplicar vía Supabase SQL Editor o mcp__supabase__apply_migration.
-- =============================================================================

-- ─── Helper GUC ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_portal_account()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT NULLIF(current_setting('app.current_portal_account', true), '')::uuid;
$$;

-- ─── RLS enable ──────────────────────────────────────────────────────────────

ALTER TABLE "PortalAccount"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortalSession"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortalMagicLink"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardianRelationship"   ENABLE ROW LEVEL SECURITY;

-- ─── PortalAccount policies ──────────────────────────────────────────────────

CREATE POLICY portal_account_select ON "PortalAccount"
  FOR SELECT TO authenticated
  USING (id = public.current_portal_account());

CREATE POLICY portal_account_update ON "PortalAccount"
  FOR UPDATE TO authenticated
  USING (id = public.current_portal_account());

-- ─── PortalSession policies ──────────────────────────────────────────────────

CREATE POLICY portal_session_select ON "PortalSession"
  FOR SELECT TO authenticated
  USING ("accountId" = public.current_portal_account());

CREATE POLICY portal_session_insert ON "PortalSession"
  FOR INSERT TO authenticated
  WITH CHECK ("accountId" = public.current_portal_account());

CREATE POLICY portal_session_update ON "PortalSession"
  FOR UPDATE TO authenticated
  USING ("accountId" = public.current_portal_account());

-- ─── PortalMagicLink policies (solo lectura propia) ──────────────────────────

CREATE POLICY portal_magic_link_select ON "PortalMagicLink"
  FOR SELECT TO authenticated
  USING ("accountId" = public.current_portal_account());

-- ─── GuardianRelationship policies ───────────────────────────────────────────

CREATE POLICY guardian_relationship_select ON "GuardianRelationship"
  FOR SELECT TO authenticated
  USING (
    "guardianAccountId" = public.current_portal_account()
    AND status IN ('ACTIVE', 'EXPIRED')
  );

-- ─── Audit triggers ──────────────────────────────────────────────────────────

CREATE TRIGGER portal_account_audit
  AFTER INSERT OR UPDATE OR DELETE ON "PortalAccount"
  FOR EACH ROW EXECUTE FUNCTION audit.if_modified_func();

CREATE TRIGGER portal_session_audit
  AFTER INSERT OR UPDATE OR DELETE ON "PortalSession"
  FOR EACH ROW EXECUTE FUNCTION audit.if_modified_func();

CREATE TRIGGER guardian_relationship_audit
  AFTER INSERT OR UPDATE OR DELETE ON "GuardianRelationship"
  FOR EACH ROW EXECUTE FUNCTION audit.if_modified_func();

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- Unicidad parcial de email para cuentas activas/pendientes.
CREATE UNIQUE INDEX portal_account_email_active_idx
  ON "PortalAccount" (email)
  WHERE status IN ('ACTIVE', 'PENDING_VERIFICATION');

-- Para limpieza por pg_cron de sesiones/links expirados.
CREATE INDEX portal_session_expires_cleanup_idx
  ON "PortalSession" ("expiresAt")
  WHERE "revokedAt" IS NULL;

CREATE INDEX portal_magic_link_expires_cleanup_idx
  ON "PortalMagicLink" ("expiresAt")
  WHERE "consumedAt" IS NULL;

-- ─── Grants ──────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON "PortalAccount"        TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "PortalSession"         TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "PortalMagicLink"       TO authenticated;
GRANT SELECT                  ON "GuardianRelationship"  TO authenticated;
