-- =============================================================================
-- HIS Multi-país | RLS Policies — §17 LIS (Sprint 4 / Phase 4 entry)
--
-- Cobertura:
--   - public."LabPanel"     — catálogo: SELECT abierto si org NULL O match. Modify org.
--   - public."LabTest"      — idem catálogo.
--   - public."LabOrder"     — tenant-isolation directo (organizationId).
--   - public."LabOrderItem" — hereda de LabOrder (via orderId).
--   - public."LabSpecimen"  — hereda de LabOrder (via orderId).
--   - public."LabResult"    — hereda dos saltos (orderItem → order).
--
-- Idempotente. Aplicar DESPUÉS de mergear claude/team4-lis.
-- =============================================================================

ALTER TABLE public."LabPanel"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LabTest"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LabOrder"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LabOrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LabSpecimen"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LabResult"    ENABLE ROW LEVEL SECURITY;

-- Grants para rol app.
GRANT SELECT ON public."LabPanel"     TO authenticated;
GRANT SELECT ON public."LabTest"      TO authenticated;
GRANT SELECT ON public."LabOrder"     TO authenticated;
GRANT SELECT ON public."LabOrderItem" TO authenticated;
GRANT SELECT ON public."LabSpecimen"  TO authenticated;
GRANT SELECT ON public."LabResult"    TO authenticated;

-- LabPanel + LabTest: catálogos (global o por org) ----------------------------
DROP POLICY IF EXISTS lab_panel_global_or_tenant_select ON public."LabPanel";
CREATE POLICY lab_panel_global_or_tenant_select ON public."LabPanel"
  FOR SELECT
  USING ("organizationId" IS NULL OR "organizationId" = public.current_org_id());

DROP POLICY IF EXISTS lab_panel_tenant_modify ON public."LabPanel";
CREATE POLICY lab_panel_tenant_modify ON public."LabPanel"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DROP POLICY IF EXISTS lab_test_global_or_tenant_select ON public."LabTest";
CREATE POLICY lab_test_global_or_tenant_select ON public."LabTest"
  FOR SELECT
  USING ("organizationId" IS NULL OR "organizationId" = public.current_org_id());

DROP POLICY IF EXISTS lab_test_tenant_modify ON public."LabTest";
CREATE POLICY lab_test_tenant_modify ON public."LabTest"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- LabOrder: tenant-isolation directo ------------------------------------------
DROP POLICY IF EXISTS lab_order_tenant_select ON public."LabOrder";
CREATE POLICY lab_order_tenant_select ON public."LabOrder"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS lab_order_tenant_modify ON public."LabOrder";
CREATE POLICY lab_order_tenant_modify ON public."LabOrder"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- LabOrderItem + LabSpecimen: heredan de LabOrder (vía orderId) ---------------
DROP POLICY IF EXISTS lab_order_item_inherit ON public."LabOrderItem";
CREATE POLICY lab_order_item_inherit ON public."LabOrderItem"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."LabOrder" o
     WHERE o.id = "orderId"
       AND o."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."LabOrder" o
     WHERE o.id = "orderId"
       AND o."organizationId" = public.current_org_id()
  ));

DROP POLICY IF EXISTS lab_specimen_inherit ON public."LabSpecimen";
CREATE POLICY lab_specimen_inherit ON public."LabSpecimen"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."LabOrder" o
     WHERE o.id = "orderId"
       AND o."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."LabOrder" o
     WHERE o.id = "orderId"
       AND o."organizationId" = public.current_org_id()
  ));

-- LabResult: hereda dos saltos (result → orderItem → order) -------------------
DROP POLICY IF EXISTS lab_result_inherit ON public."LabResult";
CREATE POLICY lab_result_inherit ON public."LabResult"
  FOR ALL
  USING (EXISTS (
    SELECT 1
      FROM public."LabOrderItem" oi
      JOIN public."LabOrder" o ON o.id = oi."orderId"
     WHERE oi.id = "orderItemId"
       AND o."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1
      FROM public."LabOrderItem" oi
      JOIN public."LabOrder" o ON o.id = oi."orderId"
     WHERE oi.id = "orderItemId"
       AND o."organizationId" = public.current_org_id()
  ));
