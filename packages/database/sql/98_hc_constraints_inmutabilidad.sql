-- =============================================================================
-- HC-003: CHECK constraint en ece.historia_clinica.estado_registro
-- HC-005: Trigger inmutabilidad post-firma
--
-- Norma: NTEC Art. 7 — integridad documental historia clínica.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- HC-003: Garantizar que estado_registro solo admita valores válidos NTEC.
--
-- NOTA: El DEFAULT actual es 'vigente' (DDL original), pero el código
-- de aplicación usa 'borrador' como estado inicial. Cambiamos el default
-- y añadimos el CHECK que incluye los estados del workflow.
-- ---------------------------------------------------------------------------

-- Actualizar filas con estado inválido (por si hay datos legacy 'vigente')
UPDATE ece.historia_clinica
SET estado_registro = 'borrador'
WHERE estado_registro NOT IN ('borrador', 'firmado', 'validado', 'anulado');

-- Corregir el DEFAULT para coincidir con el workflow de la aplicación
ALTER TABLE ece.historia_clinica
  ALTER COLUMN estado_registro SET DEFAULT 'borrador';

-- Añadir CHECK constraint con los estados NTEC válidos
ALTER TABLE ece.historia_clinica
  ADD CONSTRAINT chk_hc_estado_registro
  CHECK (estado_registro IN ('borrador', 'firmado', 'validado', 'anulado'));

-- ---------------------------------------------------------------------------
-- HC-005: Trigger de inmutabilidad post-firma.
--
-- Bloquea UPDATE de campos clínicos y DELETE cuando estado_registro = 'firmado'
-- o 'validado'. Patrón idéntico al trigger de epicrisis (trg_epicrisis_inmutable).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.fn_hc_bloquea_mutacion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Bloquear DELETE en cualquier estado distinto de borrador/anulado
  IF TG_OP = 'DELETE' AND OLD.estado_registro IN ('firmado', 'validado') THEN
    RAISE EXCEPTION
      'historia_clinica inmutable: no se puede eliminar un documento en estado % (NTEC Art. 7)',
      OLD.estado_registro
    USING ERRCODE = 'restrict_violation';
  END IF;

  -- Bloquear UPDATE de campos clínicos si ya está firmado o validado.
  -- Se permite actualizar estado_registro (para transición firmado→validado via trigger).
  IF TG_OP = 'UPDATE' AND OLD.estado_registro IN ('firmado', 'validado') THEN
    -- Solo se permite la transición firmado→validado (cambia exclusivamente estado_registro)
    IF NOT (
      NEW.estado_registro IS DISTINCT FROM OLD.estado_registro
      AND NEW.tipo_consulta IS NOT DISTINCT FROM OLD.tipo_consulta
      AND NEW.motivo_consulta IS NOT DISTINCT FROM OLD.motivo_consulta
      AND NEW.enfermedad_actual IS NOT DISTINCT FROM OLD.enfermedad_actual
      AND NEW.disposicion IS NOT DISTINCT FROM OLD.disposicion
      AND NEW.plan_manejo IS NOT DISTINCT FROM OLD.plan_manejo
      AND NEW.antecedentes IS NOT DISTINCT FROM OLD.antecedentes
      AND NEW.examen_fisico IS NOT DISTINCT FROM OLD.examen_fisico
      AND NEW.diagnosticos IS NOT DISTINCT FROM OLD.diagnosticos
    ) THEN
      RAISE EXCEPTION
        'historia_clinica inmutable: no se pueden modificar campos clínicos en estado % (NTEC Art. 7)',
        OLD.estado_registro
      USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hc_inmutable ON ece.historia_clinica;

CREATE TRIGGER trg_hc_inmutable
  BEFORE UPDATE OR DELETE ON ece.historia_clinica
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_hc_bloquea_mutacion();

COMMENT ON CONSTRAINT chk_hc_estado_registro ON ece.historia_clinica
  IS 'HC-003: estados NTEC válidos — borrador/firmado/validado/anulado';

COMMENT ON FUNCTION ece.fn_hc_bloquea_mutacion()
  IS 'HC-005: bloquea modificación/eliminación de HC en estado firmado o validado (NTEC Art. 7)';
