-- =====================================================================
-- 99_epicrisis_workflow.sql
-- S2-Tier4 A-01/A-02/A-05: Epicrisis — columnas workflow + trigger condicional.
--
-- Hallazgos cerrados:
--   A-01: cie10_principal / cie10_secundarios ya existían desde migración previa.
--   A-02: columnas estado_workflow, firma_*_id, resumen_ingreso, evolucion_hospitalaria,
--         tratamiento_egreso, indicaciones_egreso, *_en, motivo_anulacion.
--   A-05: trigger fn_bloquea_mutacion_epicrisis() condicional (bloquea solo post-firma).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + DROP/CREATE TRIGGER.
-- Aplicado: 2026-05-19 vía mcp__supabase__apply_migration.
-- =====================================================================

-- A-02: columnas de workflow
ALTER TABLE ece.epicrisis_egreso
  ADD COLUMN IF NOT EXISTS estado_workflow        TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado_workflow IN ('borrador','firmado','validado','certificado','anulado')),
  ADD COLUMN IF NOT EXISTS firma_mc_id            UUID,
  ADD COLUMN IF NOT EXISTS firma_esp_id           UUID,
  ADD COLUMN IF NOT EXISTS firma_dir_id           UUID,
  ADD COLUMN IF NOT EXISTS resumen_ingreso        TEXT,
  ADD COLUMN IF NOT EXISTS evolucion_hospitalaria TEXT,
  ADD COLUMN IF NOT EXISTS tratamiento_egreso     TEXT,
  ADD COLUMN IF NOT EXISTS indicaciones_egreso    TEXT,
  ADD COLUMN IF NOT EXISTS firmado_en             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validado_en            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS certificado_en         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anulado_en             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_anulacion       TEXT;

-- A-05: trigger condicional — bloquea solo cuando ya está firmado/certificado/anulado.
-- Permite UPDATE en estado borrador/validado para el workflow progresivo.
CREATE OR REPLACE FUNCTION ece.fn_bloquea_mutacion_epicrisis()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado_workflow IN ('firmado', 'certificado', 'anulado') THEN
    RAISE EXCEPTION
      'mutacion_no_permitida: epicrisis en estado % es inmutable (Art. 40 NTEC). '
      'Use el flujo de rectificación para correcciones.',
      OLD.estado_workflow;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ece.fn_bloquea_mutacion_epicrisis() IS
  'Trigger BEFORE UPDATE/DELETE en ece.epicrisis_egreso. '
  'Bloquea solo cuando estado_workflow IN (firmado, certificado, anulado). '
  'Permite UPDATE en borrador para guardado de contenido clínico. Art. 40 NTEC.';

-- Reemplazar trigger genérico (trg_inmutable_epicrisis_egreso / fn_bloquea_mutacion)
-- por trigger condicional específico para esta tabla.
DROP TRIGGER IF EXISTS trg_inmutable_epicrisis_egreso ON ece.epicrisis_egreso;
DROP TRIGGER IF EXISTS trg_bloquea_epicrisis ON ece.epicrisis_egreso;
CREATE TRIGGER trg_bloquea_epicrisis
  BEFORE UPDATE OR DELETE ON ece.epicrisis_egreso
  FOR EACH ROW EXECUTE FUNCTION ece.fn_bloquea_mutacion_epicrisis();
