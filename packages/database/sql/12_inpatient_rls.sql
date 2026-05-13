-- =============================================================================
-- HIS Multi-país | RLS Policies — §11 Inpatient (Wave 7 / Phase 2 entry)
--
-- Cobertura:
--   - public."InpatientAdmission"  — tenant-isolation directo (organizationId).
--   - public."InpatientVitals"     — hereda tenant scope vía InpatientAdmission.
--   - public."InpatientKardex"     — hereda tenant scope vía InpatientAdmission.
--   - public."InpatientCarePlan"   — hereda tenant scope vía InpatientAdmission.
--
-- Helpers reusados de 01_rls_policies.sql + 04_rls_session_helpers.sql:
--   public.current_org_id(), public.is_break_glass()
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- Aplicar DESPUÉS de mergear el schema.prisma Wave 7.
-- =============================================================================

ALTER TABLE public."InpatientAdmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."InpatientVitals"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."InpatientKardex"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."InpatientCarePlan"  ENABLE ROW LEVEL SECURITY;

-- InpatientAdmission: tenant-isolation directo -------------------------------
DROP POLICY IF EXISTS inpatient_admission_tenant_select ON public."InpatientAdmission";
CREATE POLICY inpatient_admission_tenant_select ON public."InpatientAdmission"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS inpatient_admission_tenant_modify ON public."InpatientAdmission";
CREATE POLICY inpatient_admission_tenant_modify ON public."InpatientAdmission"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- InpatientVitals: heredan tenant scope vía InpatientAdmission ----------------
DROP POLICY IF EXISTS inpatient_vitals_inherit_admission ON public."InpatientVitals";
CREATE POLICY inpatient_vitals_inherit_admission ON public."InpatientVitals"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."InpatientAdmission" a
     WHERE a.id = "admissionId"
       AND a."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."InpatientAdmission" a
     WHERE a.id = "admissionId"
       AND a."organizationId" = public.current_org_id()
  ));

-- InpatientKardex: heredan tenant scope vía InpatientAdmission ----------------
DROP POLICY IF EXISTS inpatient_kardex_inherit_admission ON public."InpatientKardex";
CREATE POLICY inpatient_kardex_inherit_admission ON public."InpatientKardex"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."InpatientAdmission" a
     WHERE a.id = "admissionId"
       AND a."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."InpatientAdmission" a
     WHERE a.id = "admissionId"
       AND a."organizationId" = public.current_org_id()
  ));

-- InpatientCarePlan: heredan tenant scope vía InpatientAdmission --------------
DROP POLICY IF EXISTS inpatient_care_plan_inherit_admission ON public."InpatientCarePlan";
CREATE POLICY inpatient_care_plan_inherit_admission ON public."InpatientCarePlan"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."InpatientAdmission" a
     WHERE a.id = "admissionId"
       AND a."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."InpatientAdmission" a
     WHERE a.id = "admissionId"
       AND a."organizationId" = public.current_org_id()
  ));
