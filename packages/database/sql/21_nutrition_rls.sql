-- =============================================================================
-- HIS Multi-país | RLS Policies — §22 Nutrition (Wave 8)
--
-- Cobertura:
--   - public."DietPlan"            — tenant-isolation directo (organizationId).
--   - public."NutritionAssessment" — tenant-isolation directo (organizationId).
--   - public."NutritionOrder"      — tenant-isolation directo (organizationId).
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- =============================================================================

ALTER TABLE public."DietPlan"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."NutritionAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."NutritionOrder"      ENABLE ROW LEVEL SECURITY;

-- DietPlan -------------------------------------------------------------------
DROP POLICY IF EXISTS diet_plan_tenant_select ON public."DietPlan";
CREATE POLICY diet_plan_tenant_select ON public."DietPlan"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS diet_plan_tenant_modify ON public."DietPlan";
CREATE POLICY diet_plan_tenant_modify ON public."DietPlan"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- NutritionAssessment --------------------------------------------------------
DROP POLICY IF EXISTS nutrition_assessment_tenant_select ON public."NutritionAssessment";
CREATE POLICY nutrition_assessment_tenant_select ON public."NutritionAssessment"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS nutrition_assessment_tenant_modify ON public."NutritionAssessment";
CREATE POLICY nutrition_assessment_tenant_modify ON public."NutritionAssessment"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- NutritionOrder -------------------------------------------------------------
DROP POLICY IF EXISTS nutrition_order_tenant_select ON public."NutritionOrder";
CREATE POLICY nutrition_order_tenant_select ON public."NutritionOrder"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS nutrition_order_tenant_modify ON public."NutritionOrder";
CREATE POLICY nutrition_order_tenant_modify ON public."NutritionOrder"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());
