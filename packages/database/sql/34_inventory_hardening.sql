-- =============================================================================
-- §19 Inventory — Hardening Layer 1 (Beta.10, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento manual — NO prod auto)
-- Estado: NO ejecutado en prod. Documentado para aplicación post-cierre Beta.10.
--
-- Cambios:
--   1. Columna reservedQty en stock_lot.
--   2. Columna transfer_group_id en stock_movement + índice de soporte.
--   3. CHECK constraint: stock_lot.quantity_on_hand >= 0 (prevención stock negativo).
--   4. Trigger append-only: BLOCK UPDATE/DELETE en stock_movement.
--   5. Trigger FEFO: en OUT movements, bloquea si hay lot con expiryDate anterior
--      no consumido para el mismo item+establishment.
--   6. Índice FEFO: ix_stock_lot_fefo para queries de FEFO.
--   7. Índice expiry alerts: ix_stock_lot_expiry_alerts.
--
-- Convención: TODO el SQL es idempotente (IF NOT EXISTS / OR REPLACE / DROP
-- TRIGGER IF EXISTS) para soportar re-ejecución sin error.
--
-- NOTA: Los nombres de tabla en PostgreSQL son snake_case (mapeados por Prisma
-- desde PascalCase). Verificar nombre exacto en el esquema antes de aplicar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columna reservedQty en stock_lot
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'StockLot'
      AND column_name = 'reservedQty'
  ) THEN
    ALTER TABLE public."StockLot"
      ADD COLUMN "reservedQty" NUMERIC(18, 4) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Columna transferGroupId en stock_movement + índice
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'StockMovement'
      AND column_name = 'transferGroupId'
  ) THEN
    ALTER TABLE public."StockMovement"
      ADD COLUMN "transferGroupId" UUID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_stock_movement_transfer_group
  ON public."StockMovement" ("transferGroupId")
  WHERE "transferGroupId" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. CHECK constraint — prevención stock negativo
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_lot_qty_nonneg_chk'
  ) THEN
    ALTER TABLE public."StockLot"
      ADD CONSTRAINT stock_lot_qty_nonneg_chk
      CHECK ("quantityOnHand" >= 0);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Trigger — append-only: BLOCK UPDATE/DELETE en StockMovement
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_stock_movement_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'StockMovement es append-only: UPDATE no permitido (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'StockMovement es append-only: DELETE no permitido (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Should not be reached, but defensive return.
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_stock_movement_append_only ON public."StockMovement";
CREATE TRIGGER tr_stock_movement_append_only
  BEFORE UPDATE OR DELETE ON public."StockMovement"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_stock_movement_append_only();

-- -----------------------------------------------------------------------------
-- 5. Trigger — FEFO enforcement on OUT movements
--
-- When a new StockMovement of type OUT (or TRANSFER acting as an outgoing leg)
-- is inserted with a lotId, this trigger checks whether there exists another
-- active lot for the same item + establishment with:
--   - a non-null expiryDate
--   - an earlier expiryDate than the consumed lot
--   - quantityOnHand > 0
--
-- If such a lot exists, the insert is blocked with:
--   "FEFO violation: lot <lotNumber> expires earlier"
--
-- Lots without expiryDate are never considered violations (non-expiring stock).
-- TRANSFER movements share the same logic because the DB cannot distinguish
-- the OUT leg from the IN leg; FEFO is also enforced in the router layer.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_stock_movement_fefo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_lot_expiry       DATE;
  v_earlier_lot_id   UUID;
  v_earlier_lot_num  VARCHAR(80);
BEGIN
  -- Only enforce on OUT (and TRANSFER for the outgoing leg).
  -- ADJUST and IN are exempt.
  IF NEW.type NOT IN ('OUT', 'TRANSFER') THEN
    RETURN NEW;
  END IF;

  -- No lot specified: no FEFO check possible.
  IF NEW."lotId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the expiryDate of the lot being consumed.
  SELECT "expiryDate" INTO v_lot_expiry
  FROM public."StockLot"
  WHERE id = NEW."lotId";

  -- If the consumed lot has no expiry, it can never violate FEFO.
  IF v_lot_expiry IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find any earlier-expiring lot for the same item + establishment with stock.
  SELECT id, "lotNumber" INTO v_earlier_lot_id, v_earlier_lot_num
  FROM public."StockLot"
  WHERE "itemId"          = NEW."itemId"
    AND "establishmentId" = NEW."establishmentId"
    AND "organizationId"  = NEW."organizationId"
    AND active            = TRUE
    AND "quantityOnHand"  > 0
    AND "expiryDate"      IS NOT NULL
    AND "expiryDate"      < v_lot_expiry
    AND id                <> NEW."lotId"
  ORDER BY "expiryDate" ASC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'FEFO violation: lot % expires earlier', v_earlier_lot_num
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_stock_movement_fefo ON public."StockMovement";
CREATE TRIGGER tr_stock_movement_fefo
  BEFORE INSERT ON public."StockMovement"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_stock_movement_fefo();

-- -----------------------------------------------------------------------------
-- 6. Índice FEFO — soporte para el trigger y queries de FEFO en router
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_stock_lot_fefo
  ON public."StockLot" ("organizationId", "itemId", "establishmentId", "expiryDate")
  WHERE active = TRUE AND "quantityOnHand" > 0 AND "expiryDate" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 7. Índice expiry alerts — soporte para expiringLots endpoint
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_stock_lot_expiry_alerts
  ON public."StockLot" ("organizationId", "expiryDate")
  WHERE active = TRUE AND "quantityOnHand" > 0 AND "expiryDate" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 8. Verificación post-aplicación
-- -----------------------------------------------------------------------------

-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'StockLot'
--   AND column_name IN ('reservedQty');
-- -- Debe retornar 1 fila

-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'StockMovement'
--   AND column_name IN ('transferGroupId');
-- -- Debe retornar 1 fila

-- SELECT conname FROM pg_constraint WHERE conname = 'stock_lot_qty_nonneg_chk';
-- -- Debe retornar 1 fila

-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public."StockMovement"'::regclass;
-- -- Debe incluir tr_stock_movement_append_only y tr_stock_movement_fefo

-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'StockLot'
--   AND indexname IN ('ix_stock_lot_fefo', 'ix_stock_lot_expiry_alerts');
-- -- Debe retornar 2 filas
-- =============================================================================
