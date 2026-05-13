-- =============================================================================
-- HIS Multi-país | RLS Policies — §19 Inventory (Wave 8 / Phase 2 entry)
--
-- Cobertura:
--   - public."StockItem"     — catálogo global (organizationId null) + tenant.
--   - public."StockLot"      — tenant-isolation directo (organizationId).
--   - public."StockMovement" — tenant-isolation directo (organizationId).
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
-- =============================================================================

ALTER TABLE public."StockItem"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StockLot"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StockMovement" ENABLE ROW LEVEL SECURITY;

-- StockItem: catálogo global + tenant ----------------------------------------
DROP POLICY IF EXISTS stock_item_tenant_select ON public."StockItem";
CREATE POLICY stock_item_tenant_select ON public."StockItem"
  FOR SELECT
  USING (
    "organizationId" IS NULL
    OR "organizationId" = public.current_org_id()
    OR public.is_break_glass()
  );

DROP POLICY IF EXISTS stock_item_tenant_modify ON public."StockItem";
CREATE POLICY stock_item_tenant_modify ON public."StockItem"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- StockLot: tenant-isolation directo -----------------------------------------
DROP POLICY IF EXISTS stock_lot_tenant_select ON public."StockLot";
CREATE POLICY stock_lot_tenant_select ON public."StockLot"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS stock_lot_tenant_modify ON public."StockLot";
CREATE POLICY stock_lot_tenant_modify ON public."StockLot"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- StockMovement: tenant-isolation directo (write-once en práctica) -----------
DROP POLICY IF EXISTS stock_movement_tenant_select ON public."StockMovement";
CREATE POLICY stock_movement_tenant_select ON public."StockMovement"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS stock_movement_tenant_insert ON public."StockMovement";
CREATE POLICY stock_movement_tenant_insert ON public."StockMovement"
  FOR INSERT
  WITH CHECK ("organizationId" = public.current_org_id());

-- StockMovement no permite UPDATE/DELETE en producción; sólo SELECT/INSERT.
-- (Auditoría inmutable — ajustes se hacen con un nuevo movement de tipo ADJUST.)
