-- =============================================================================
-- 225_stock_movement_consumption.sql
-- docs/48 Ola 3 (C3-3) — nuevo valor 'CONSUMPTION' del enum StockMovementType.
--
-- Consumo institucional no nominativo (aseo, docencia, merma): salida de
-- stock que NUNCA liga a un paciente y NUNCA pasa por `capturarCargo`
-- (packages/trpc/src/lib/charge-capture.ts) — a diferencia de OUT, que sí
-- puede representar un despacho a paciente por otro camino (dispensación
-- farmacia, `pharmacy/dispensation.router.ts`).
--
-- Lección 30a/30b (surgery enum post-op): `ALTER TYPE ... ADD VALUE` no puede
-- co-existir en la MISMA transacción con un objeto (índice, vista, función)
-- que USE ese valor nuevo — el valor solo es utilizable DESPUÉS del COMMIT.
-- Este archivo SOLO hace el ADD VALUE; ningún otro objeto de este corpus
-- referencia 'CONSUMPTION' todavía (el router `inventory.consumo` la usa vía
-- Prisma, en transacciones de aplicación posteriores a este COMMIT, no aquí).
--
-- Idempotente.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'StockMovementType' AND e.enumlabel = 'CONSUMPTION'
  ) THEN
    ALTER TYPE public."StockMovementType" ADD VALUE 'CONSUMPTION';
  END IF;
END $$;

-- Verificación manual post-apply:
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
--    WHERE t.typname = 'StockMovementType' ORDER BY e.enumsortorder;
--   -- Debe incluir: IN, OUT, TRANSFER, ADJUST, CONSUMPTION
-- APLICADO a prod 2026-09-09 vía MCP (stock_movement_consumption_225) — NO re-aplicar.
