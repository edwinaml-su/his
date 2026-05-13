-- =============================================================================
-- HIS Multi-país | RLS Policies — §16 eMAR (Wave 7 / Phase 2 entry)
--
-- Cobertura:
--   - public."MedicationAdministration" — tenant-isolation directo (organizationId).
--
-- Aunque MedicationAdministration podría inferir tenant vía PrescriptionItem,
-- materializamos organizationId en la propia tabla para evitar EXISTS por cada
-- query (alta frecuencia: enfermería registra múltiples administraciones por
-- turno). El router asegura que el organizationId coincida con el de la
-- prescription firmada.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- =============================================================================

ALTER TABLE public."MedicationAdministration" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS medication_admin_tenant_select ON public."MedicationAdministration";
CREATE POLICY medication_admin_tenant_select ON public."MedicationAdministration"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS medication_admin_tenant_modify ON public."MedicationAdministration";
CREATE POLICY medication_admin_tenant_modify ON public."MedicationAdministration"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());
