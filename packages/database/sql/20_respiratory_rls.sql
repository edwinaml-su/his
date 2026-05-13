-- =============================================================================
-- HIS Multi-país | RLS Policies — §21 Respiratory (Wave 8)
--
-- Cobertura:
--   - public."RespiratoryOrder"   — tenant-isolation directo (organizationId).
--   - public."VentilatorSession"  — hereda vía order.organizationId.
--   - public."MedicalGasUsage"    — hereda vía order.organizationId.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- =============================================================================

ALTER TABLE public."RespiratoryOrder"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VentilatorSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MedicalGasUsage"   ENABLE ROW LEVEL SECURITY;

-- RespiratoryOrder: tenant-isolation directo ---------------------------------
DROP POLICY IF EXISTS respiratory_order_tenant_select ON public."RespiratoryOrder";
CREATE POLICY respiratory_order_tenant_select ON public."RespiratoryOrder"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS respiratory_order_tenant_modify ON public."RespiratoryOrder";
CREATE POLICY respiratory_order_tenant_modify ON public."RespiratoryOrder"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- VentilatorSession: hereda vía order ----------------------------------------
DROP POLICY IF EXISTS ventilator_session_inherit_order ON public."VentilatorSession";
CREATE POLICY ventilator_session_inherit_order ON public."VentilatorSession"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."RespiratoryOrder" o
     WHERE o.id = "orderId"
       AND o."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."RespiratoryOrder" o
     WHERE o.id = "orderId"
       AND o."organizationId" = public.current_org_id()
  ));

-- MedicalGasUsage: hereda vía order ------------------------------------------
DROP POLICY IF EXISTS medical_gas_usage_inherit_order ON public."MedicalGasUsage";
CREATE POLICY medical_gas_usage_inherit_order ON public."MedicalGasUsage"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."RespiratoryOrder" o
     WHERE o.id = "orderId"
       AND o."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."RespiratoryOrder" o
     WHERE o.id = "orderId"
       AND o."organizationId" = public.current_org_id()
  ));
