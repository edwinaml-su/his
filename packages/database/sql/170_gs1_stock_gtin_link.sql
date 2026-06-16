-- =====================================================================
-- 170_gs1_stock_gtin_link.sql
-- Enlace GTIN ↔ Inventario — Nivel 3 → Nivel 2 (guía GS1 El Salvador).
--
-- Encadena el inventario transaccional (StockItem/StockLot/StockMovement)
-- con el catálogo comercial GS1 canónico (ece.gs1_gtin), cerrando la
-- integridad referencial entre los 3 niveles del estándar.
--
--   StockItem.gtin       → FK a ece.gs1_gtin(codigo): el GTIN del artículo.
--   StockLot.gtin_fisico → GTIN-14 escaneado (AI 01) del empaque manipulado;
--                          puede diferir del item por fraccionamiento, por eso
--                          es captura cruda SIN FK (el catálogo puede no tenerlo aún).
--   StockMovement.gtin_fisico → idem a nivel de movimiento.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

-- StockItem: GTIN maestro del artículo (FK al catálogo Nivel 2).
ALTER TABLE public."StockItem"
  ADD COLUMN IF NOT EXISTS gtin char(14);

ALTER TABLE public."StockItem" DROP CONSTRAINT IF EXISTS fk_stockitem_gtin;
ALTER TABLE public."StockItem"
  ADD CONSTRAINT fk_stockitem_gtin
  FOREIGN KEY (gtin) REFERENCES ece.gs1_gtin(codigo) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stockitem_gtin
  ON public."StockItem" (gtin) WHERE gtin IS NOT NULL;

-- StockLot / StockMovement: GTIN físico escaneado (captura cruda GS1 DataMatrix).
ALTER TABLE public."StockLot"
  ADD COLUMN IF NOT EXISTS gtin_fisico char(14);
ALTER TABLE public."StockMovement"
  ADD COLUMN IF NOT EXISTS gtin_fisico char(14);

CREATE INDEX IF NOT EXISTS idx_stocklot_gtin_fisico
  ON public."StockLot" (gtin_fisico) WHERE gtin_fisico IS NOT NULL;

COMMENT ON COLUMN public."StockItem".gtin IS
  'GTIN-14 del artículo. FK a ece.gs1_gtin(codigo) — enlace Nivel 3→Nivel 2 GS1.';
COMMENT ON COLUMN public."StockLot".gtin_fisico IS
  'GTIN-14 escaneado del empaque manipulado (AI 01). Captura cruda, sin FK '
  '(puede diferir del item por fraccionamiento o no estar aún en el catálogo).';
COMMENT ON COLUMN public."StockMovement".gtin_fisico IS
  'GTIN-14 escaneado en el movimiento (AI 01). Captura cruda GS1 DataMatrix.';
