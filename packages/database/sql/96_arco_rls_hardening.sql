-- =============================================================================
-- 96_arco_rls_hardening.sql — RLS fix + audit trigger ece.solicitud_arco
--
-- K-06 (P0): tabla sin audit trigger; policies con rol {public} en lugar de
-- {authenticated}; policy portal sin INSERT WITH CHECK.
-- LOPD Art. 18: trazabilidad del ejercicio de derechos ARCO obligatoria.
--
-- Estado previo en BD (2026-05-26):
--   relrowsecurity = true (ya habilitado)
--   policy portal_paciente_solicitud_arco: SELECT, roles {public}, sin WITH CHECK
--   policy tenant_staff_solicitud_arco: ALL, roles {public}, sin WITH CHECK
--   triggers de audit: ninguno
--
-- Este script es idempotente: usa DROP POLICY IF EXISTS antes de recrear.
-- =============================================================================

-- RLS ya habilitado; lo repetimos por idempotencia (no-op si ya está).
ALTER TABLE ece.solicitud_arco ENABLE ROW LEVEL SECURITY;

-- ─── Policy: paciente portal (SELECT + INSERT propias) ───────────────────────
-- Permite al paciente autenticado ver e iniciar sus propias solicitudes ARCO.
-- GUC: app.current_portal_patient_id — seteado por withPortalContext().

DROP POLICY IF EXISTS portal_paciente_solicitud_arco ON ece.solicitud_arco;
CREATE POLICY portal_paciente_solicitud_arco ON ece.solicitud_arco
  FOR SELECT TO authenticated
  USING (
    paciente_id = nullif(current_setting('app.current_portal_patient_id', true), '')::uuid
  );

DROP POLICY IF EXISTS portal_paciente_solicitud_arco_insert ON ece.solicitud_arco;
CREATE POLICY portal_paciente_solicitud_arco_insert ON ece.solicitud_arco
  FOR INSERT TO authenticated
  WITH CHECK (
    paciente_id = nullif(current_setting('app.current_portal_patient_id', true), '')::uuid
  );

-- ─── Policy: personal clínico / DIR (ALL por organización) ───────────────────
-- Permite al staff con contexto de org revisar y responder solicitudes ARCO.
-- GUC: app.current_org_id — seteado por withTenantContext().

DROP POLICY IF EXISTS tenant_staff_solicitud_arco ON ece.solicitud_arco;
CREATE POLICY tenant_staff_solicitud_arco ON ece.solicitud_arco
  FOR ALL TO authenticated
  USING (
    organizacion_id = nullif(current_setting('app.current_org_id', true), '')::uuid
  )
  WITH CHECK (
    organizacion_id = nullif(current_setting('app.current_org_id', true), '')::uuid
  );

-- ─── Audit trigger (LOPD Art. 18 / TDR §6.3) ─────────────────────────────────
-- Registra INSERT, UPDATE y DELETE en audit.AuditLog con cadena de hash.
-- Función audit.fn_audit_row() definida en 02_audit_triggers.sql.

DROP TRIGGER IF EXISTS trg_audit_solicitud_arco ON ece.solicitud_arco;
CREATE TRIGGER trg_audit_solicitud_arco
  AFTER INSERT OR UPDATE OR DELETE ON ece.solicitud_arco
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- ─── Grants (defensive — authenticated ya debería tenerlos) ──────────────────
GRANT SELECT, INSERT ON ece.solicitud_arco TO authenticated;
