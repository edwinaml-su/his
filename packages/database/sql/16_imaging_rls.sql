-- =============================================================================
-- HIS Multi-país | RLS Policies — §18 RIS/PACS (Wave 7 / Phase 2 entry)
--
-- Cobertura:
--   - public."ImagingModality" — tenant-isolation vía Establishment.organizationId.
--   - public."ImagingOrder"    — tenant-isolation directo (organizationId).
--   - public."ImagingReport"   — hereda tenant scope vía ImagingOrder.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- =============================================================================

ALTER TABLE public."ImagingModality" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ImagingOrder"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ImagingReport"   ENABLE ROW LEVEL SECURITY;

-- ImagingModality: tenant-isolation vía Establishment.organizationId ---------
DROP POLICY IF EXISTS imaging_modality_inherit_establishment ON public."ImagingModality";
CREATE POLICY imaging_modality_inherit_establishment ON public."ImagingModality"
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

-- ImagingOrder: tenant-isolation directo -------------------------------------
DROP POLICY IF EXISTS imaging_order_tenant_select ON public."ImagingOrder";
CREATE POLICY imaging_order_tenant_select ON public."ImagingOrder"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS imaging_order_tenant_modify ON public."ImagingOrder";
CREATE POLICY imaging_order_tenant_modify ON public."ImagingOrder"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- ImagingReport: hereda tenant scope vía ImagingOrder ------------------------
DROP POLICY IF EXISTS imaging_report_inherit_order ON public."ImagingReport";
CREATE POLICY imaging_report_inherit_order ON public."ImagingReport"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."ImagingOrder" o
     WHERE o.id = "orderId"
       AND o."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."ImagingOrder" o
     WHERE o.id = "orderId"
       AND o."organizationId" = public.current_org_id()
  ));
