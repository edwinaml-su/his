-- =============================================================================
-- HIS Multi-país | RLS Policies — §20 Services & Equipment (Wave 8)
--
-- Cobertura:
--   - public."BiomedicalEquipment" — tenant-isolation directo (organizationId).
--   - public."PmSchedule"          — hereda vía equipment.organizationId.
--   - public."CalibrationLog"      — hereda vía equipment.organizationId.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- =============================================================================

ALTER TABLE public."BiomedicalEquipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PmSchedule"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CalibrationLog"      ENABLE ROW LEVEL SECURITY;

-- BiomedicalEquipment: tenant-isolation directo ------------------------------
DROP POLICY IF EXISTS biomedical_equipment_tenant_select ON public."BiomedicalEquipment";
CREATE POLICY biomedical_equipment_tenant_select ON public."BiomedicalEquipment"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS biomedical_equipment_tenant_modify ON public."BiomedicalEquipment";
CREATE POLICY biomedical_equipment_tenant_modify ON public."BiomedicalEquipment"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- PmSchedule: hereda vía equipment -------------------------------------------
DROP POLICY IF EXISTS pm_schedule_inherit_equipment ON public."PmSchedule";
CREATE POLICY pm_schedule_inherit_equipment ON public."PmSchedule"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."BiomedicalEquipment" e
     WHERE e.id = "equipmentId"
       AND e."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."BiomedicalEquipment" e
     WHERE e.id = "equipmentId"
       AND e."organizationId" = public.current_org_id()
  ));

-- CalibrationLog: hereda vía equipment ---------------------------------------
DROP POLICY IF EXISTS calibration_log_inherit_equipment ON public."CalibrationLog";
CREATE POLICY calibration_log_inherit_equipment ON public."CalibrationLog"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."BiomedicalEquipment" e
     WHERE e.id = "equipmentId"
       AND e."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."BiomedicalEquipment" e
     WHERE e.id = "equipmentId"
       AND e."organizationId" = public.current_org_id()
  ));
