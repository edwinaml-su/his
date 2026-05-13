-- =============================================================================
-- HIS Multi-país | RLS Policies — §25 Insurer Agreements (Wave 8 / Phase 2 entry)
--
-- Cobertura:
--   - public."Insurer"              — catálogo global (organizationId null) +
--                                     tenant-private; visible si null OR tenant.
--   - public."InsurancePlan"        — hereda visibilidad del Insurer (vía relación).
--   - public."PatientCoverage"      — tenant-isolation directo (organizationId).
--   - public."AuthorizationRequest" — tenant-isolation directo (organizationId).
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- =============================================================================

ALTER TABLE public."Insurer"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."InsurancePlan"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientCoverage"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AuthorizationRequest" ENABLE ROW LEVEL SECURITY;

-- Insurer: catálogo global + tenant-private ----------------------------------
DROP POLICY IF EXISTS insurer_tenant_select ON public."Insurer";
CREATE POLICY insurer_tenant_select ON public."Insurer"
  FOR SELECT
  USING (
    "organizationId" IS NULL
    OR "organizationId" = public.current_org_id()
    OR public.is_break_glass()
  );

DROP POLICY IF EXISTS insurer_tenant_modify ON public."Insurer";
CREATE POLICY insurer_tenant_modify ON public."Insurer"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- InsurancePlan: hereda visibilidad del Insurer ------------------------------
DROP POLICY IF EXISTS insurance_plan_inherit_insurer ON public."InsurancePlan";
CREATE POLICY insurance_plan_inherit_insurer ON public."InsurancePlan"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."Insurer" i
     WHERE i.id = "insurerId"
       AND (i."organizationId" IS NULL OR i."organizationId" = public.current_org_id())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Insurer" i
     WHERE i.id = "insurerId"
       AND (i."organizationId" IS NULL OR i."organizationId" = public.current_org_id())
  ));

-- PatientCoverage: tenant-isolation directo ----------------------------------
DROP POLICY IF EXISTS patient_coverage_tenant_select ON public."PatientCoverage";
CREATE POLICY patient_coverage_tenant_select ON public."PatientCoverage"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS patient_coverage_tenant_modify ON public."PatientCoverage";
CREATE POLICY patient_coverage_tenant_modify ON public."PatientCoverage"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- AuthorizationRequest: tenant-isolation directo -----------------------------
DROP POLICY IF EXISTS authorization_request_tenant_select ON public."AuthorizationRequest";
CREATE POLICY authorization_request_tenant_select ON public."AuthorizationRequest"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS authorization_request_tenant_modify ON public."AuthorizationRequest";
CREATE POLICY authorization_request_tenant_modify ON public."AuthorizationRequest"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());
