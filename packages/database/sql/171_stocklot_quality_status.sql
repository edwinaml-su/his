-- =====================================================================
-- 171_stocklot_quality_status.sql
-- Estado de calidad por lote — Nivel 3 (guía GS1 El Salvador).
--
-- Materializa el Estado_Calidad del estándar a nivel StockLot, permitiendo
-- bloquear la dispensación/salida de lotes en cuarentena o bajo alerta
-- sanitaria (Recall), no solo por caducidad.
--
--   AVAILABLE  — disponible para dispensación.
--   QUARANTINE — retenido (control de calidad, recepción pendiente).
--   RECALL     — alerta sanitaria activa (farmacovigilancia).
--   EXPIRED    — caducado (marca explícita; el bloqueo por fecha ya existe).
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

ALTER TABLE public."StockLot"
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'AVAILABLE';

ALTER TABLE public."StockLot" DROP CONSTRAINT IF EXISTS chk_stocklot_quality_status;
ALTER TABLE public."StockLot"
  ADD CONSTRAINT chk_stocklot_quality_status
  CHECK (quality_status IN ('AVAILABLE','QUARANTINE','RECALL','EXPIRED'));

-- Índice parcial: solo lotes NO disponibles (los casos a vigilar).
CREATE INDEX IF NOT EXISTS idx_stocklot_quality_status
  ON public."StockLot" (quality_status) WHERE quality_status <> 'AVAILABLE';

COMMENT ON COLUMN public."StockLot".quality_status IS
  'Estado de calidad GS1 Nivel 3: AVAILABLE|QUARANTINE|RECALL|EXPIRED. '
  'Bloquea dispensación/salida cuando <> AVAILABLE.';
