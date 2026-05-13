-- =============================================================================
-- HIS Multi-país | RLS Policies — §13 Surgery (Wave 7 / Phase 2 entry)
--
-- Cobertura:
--   - public."OperatingRoom" — tenant-isolation vía Establishment.organizationId.
--   - public."SurgeryCase"   — tenant-isolation directo (organizationId).
--
-- OperatingRoom cuelga de Establishment (no de Organization), igual que Bed
-- en 01_rls_policies.sql. Se aplica el mismo patrón EXISTS sobre Establishment.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- =============================================================================

ALTER TABLE public."OperatingRoom" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SurgeryCase"   ENABLE ROW LEVEL SECURITY;

-- OperatingRoom: tenant-isolation vía Establishment.organizationId -----------
DROP POLICY IF EXISTS operating_room_inherit_establishment ON public."OperatingRoom";
CREATE POLICY operating_room_inherit_establishment ON public."OperatingRoom"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."Establishment" e
     WHERE e.id = "establishmentId"
       AND e."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Establishment" e
     WHERE e.id = "establishmentId"
       AND e."organizationId" = public.current_org_id()
  ));

-- SurgeryCase: tenant-isolation directo --------------------------------------
DROP POLICY IF EXISTS surgery_case_tenant_select ON public."SurgeryCase";
CREATE POLICY surgery_case_tenant_select ON public."SurgeryCase"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS surgery_case_tenant_modify ON public."SurgeryCase";
CREATE POLICY surgery_case_tenant_modify ON public."SurgeryCase"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());
