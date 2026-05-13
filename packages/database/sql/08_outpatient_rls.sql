-- =============================================================================
-- HIS Multi-país | RLS Policies — §10 Outpatient (Sprint 4 / Phase 2 entry)
--
-- Cobertura:
--   - public."OutpatientAppointment" — tenant-isolation directo (organizationId).
--   - public."OutpatientConsultation" — hereda tenant scope vía Encounter.
--
-- Helpers reusados de 01_rls_policies.sql + 04_rls_session_helpers.sql:
--   public.current_org_id(), public.is_break_glass()
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- Aplicar DESPUÉS de mergear claude/team2-outpatient (modelos en schema.prisma).
-- =============================================================================

ALTER TABLE public."OutpatientAppointment"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OutpatientConsultation" ENABLE ROW LEVEL SECURITY;

-- OutpatientAppointment: tenant-isolation directo ----------------------------
DROP POLICY IF EXISTS outpatient_appointment_tenant_select ON public."OutpatientAppointment";
CREATE POLICY outpatient_appointment_tenant_select ON public."OutpatientAppointment"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS outpatient_appointment_tenant_modify ON public."OutpatientAppointment";
CREATE POLICY outpatient_appointment_tenant_modify ON public."OutpatientAppointment"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- OutpatientConsultation: hereda de Encounter --------------------------------
-- Pattern EXISTS (similar a BedAssignment en 01_rls_policies.sql líneas 186-194).
DROP POLICY IF EXISTS outpatient_consultation_inherit_encounter ON public."OutpatientConsultation";
CREATE POLICY outpatient_consultation_inherit_encounter ON public."OutpatientConsultation"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."Encounter" e
     WHERE e.id = "encounterId"
       AND e."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Encounter" e
     WHERE e.id = "encounterId"
       AND e."organizationId" = public.current_org_id()
  ));
