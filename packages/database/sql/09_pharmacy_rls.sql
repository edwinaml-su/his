-- =============================================================================
-- HIS Multi-país | RLS Policies — §15 Pharmacy (Sprint 4 / Phase 4 entry)
--
-- Cobertura:
--   - public."Drug"               — catálogo: SELECT abierto si org NULL O org match. Modify only org match.
--   - public."Prescription"       — tenant-isolation directo (organizationId).
--   - public."PrescriptionItem"   — hereda de Prescription (via prescriptionId).
--   - public."MedicationDispense" — hereda dos saltos (item → prescription).
--
-- Idempotente. Aplicar DESPUÉS de mergear claude/team3-pharmacy.
-- =============================================================================

ALTER TABLE public."Drug"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Prescription"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PrescriptionItem"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MedicationDispense" ENABLE ROW LEVEL SECURITY;

-- Grants para que rol app entre al schema (RLS encima decide visibilidad).
GRANT SELECT ON public."Drug"               TO authenticated;
GRANT SELECT ON public."Prescription"       TO authenticated;
GRANT SELECT ON public."PrescriptionItem"   TO authenticated;
GRANT SELECT ON public."MedicationDispense" TO authenticated;

-- Drug: catálogo global (organizationId NULL) + por-org -----------------------
DROP POLICY IF EXISTS drug_global_or_tenant_select ON public."Drug";
CREATE POLICY drug_global_or_tenant_select ON public."Drug"
  FOR SELECT
  USING ("organizationId" IS NULL OR "organizationId" = public.current_org_id());

DROP POLICY IF EXISTS drug_tenant_modify ON public."Drug";
CREATE POLICY drug_tenant_modify ON public."Drug"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- Prescription: tenant-isolation directo --------------------------------------
DROP POLICY IF EXISTS prescription_tenant_select ON public."Prescription";
CREATE POLICY prescription_tenant_select ON public."Prescription"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS prescription_tenant_modify ON public."Prescription";
CREATE POLICY prescription_tenant_modify ON public."Prescription"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- PrescriptionItem: hereda de Prescription ------------------------------------
DROP POLICY IF EXISTS prescription_item_inherit ON public."PrescriptionItem";
CREATE POLICY prescription_item_inherit ON public."PrescriptionItem"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."Prescription" p
     WHERE p.id = "prescriptionId"
       AND p."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Prescription" p
     WHERE p.id = "prescriptionId"
       AND p."organizationId" = public.current_org_id()
  ));

-- MedicationDispense: hereda dos saltos (dispense → item → prescription) ------
DROP POLICY IF EXISTS medication_dispense_inherit ON public."MedicationDispense";
CREATE POLICY medication_dispense_inherit ON public."MedicationDispense"
  FOR ALL
  USING (EXISTS (
    SELECT 1
      FROM public."PrescriptionItem" pi
      JOIN public."Prescription" p ON p.id = pi."prescriptionId"
     WHERE pi.id = "prescriptionItemId"
       AND p."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1
      FROM public."PrescriptionItem" pi
      JOIN public."Prescription" p ON p.id = pi."prescriptionId"
     WHERE pi.id = "prescriptionItemId"
       AND p."organizationId" = public.current_org_id()
  ));
