-- =============================================================================
-- HIS Multi-país | RLS Policies — §12 Emergency (Wave 7 / Phase 2 entry)
--
-- Cobertura:
--   - public."EmergencyVisit" — tenant-isolation directo (organizationId).
--   - public."EmergencyNote"  — hereda tenant scope vía EmergencyVisit.
--
-- Helpers reusados de 01_rls_policies.sql + 04_rls_session_helpers.sql:
--   public.current_org_id(), public.is_break_glass()
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- =============================================================================

ALTER TABLE public."EmergencyVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EmergencyNote"  ENABLE ROW LEVEL SECURITY;

-- EmergencyVisit: tenant-isolation directo -----------------------------------
DROP POLICY IF EXISTS emergency_visit_tenant_select ON public."EmergencyVisit";
CREATE POLICY emergency_visit_tenant_select ON public."EmergencyVisit"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS emergency_visit_tenant_modify ON public."EmergencyVisit";
CREATE POLICY emergency_visit_tenant_modify ON public."EmergencyVisit"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- EmergencyNote: hereda tenant scope vía EmergencyVisit ----------------------
DROP POLICY IF EXISTS emergency_note_inherit_visit ON public."EmergencyNote";
CREATE POLICY emergency_note_inherit_visit ON public."EmergencyNote"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."EmergencyVisit" v
     WHERE v.id = "visitId"
       AND v."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."EmergencyVisit" v
     WHERE v.id = "visitId"
       AND v."organizationId" = public.current_org_id()
  ));
