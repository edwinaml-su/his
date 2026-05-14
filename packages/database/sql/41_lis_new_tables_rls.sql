-- =============================================================================
-- HIS SQL 41 — RLS policies para LabReferenceRange y LabReflexRule
--
-- Cierra los 2 advisors INFO `rls_enabled_no_policy` de las tablas creadas
-- por 27_lis_hardening_v2. Patrón idéntico al de LabTest / LabPanel:
--   - SELECT: catálogo global (organizationId IS NULL) o del tenant.
--   - INSERT/UPDATE/DELETE: solo del tenant (no permite escribir globales
--     desde rol authenticated; el service_role bypasea RLS para seeds).
--
-- Idempotente: DROP POLICY IF EXISTS antes de CREATE POLICY.
-- =============================================================================

-- LabReferenceRange -----------------------------------------------------------

DROP POLICY IF EXISTS lab_reference_range_global_or_tenant_select ON public."LabReferenceRange";
CREATE POLICY lab_reference_range_global_or_tenant_select
  ON public."LabReferenceRange"
  FOR SELECT
  USING ("organizationId" IS NULL OR "organizationId" = current_org_id());

DROP POLICY IF EXISTS lab_reference_range_tenant_modify ON public."LabReferenceRange";
CREATE POLICY lab_reference_range_tenant_modify
  ON public."LabReferenceRange"
  FOR ALL
  USING ("organizationId" = current_org_id())
  WITH CHECK ("organizationId" = current_org_id());

-- LabReflexRule ---------------------------------------------------------------

DROP POLICY IF EXISTS lab_reflex_rule_global_or_tenant_select ON public."LabReflexRule";
CREATE POLICY lab_reflex_rule_global_or_tenant_select
  ON public."LabReflexRule"
  FOR SELECT
  USING ("organizationId" IS NULL OR "organizationId" = current_org_id());

DROP POLICY IF EXISTS lab_reflex_rule_tenant_modify ON public."LabReflexRule";
CREATE POLICY lab_reflex_rule_tenant_modify
  ON public."LabReflexRule"
  FOR ALL
  USING ("organizationId" = current_org_id())
  WITH CHECK ("organizationId" = current_org_id());

-- Audit triggers (mirroring SQL 22 phase2 audit) ------------------------------
-- Si SQL 22 ya instaló audit triggers genéricos por relkind, estas tablas ya
-- los heredan al haber relrowsecurity habilitado. Si no fuera el caso, se
-- añadirían acá con trg_audit_<Tabla>.

-- Verificación post-apply:
--   SELECT COUNT(*) FROM pg_policies WHERE schemaname='public'
--     AND tablename IN ('LabReferenceRange','LabReflexRule');
--   -- = 4 (2 por tabla)
