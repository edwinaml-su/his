-- =============================================================================
-- 181_cc0006_evolucion_data_immutable.sql
-- CC-0006 / REQ-ECE-EVO — Evolución Médica SOAP orientada a problemas.
--
-- Dos cambios:
--   1) ADD COLUMN data jsonb  → aloja problemas[]/plan[]/signosVitalesId del
--      flujo modal-driven. ADEMÁS destraba un bug P0 pre-existente: el router
--      `evolucion-medica.create` (PR #479, ya en main) hace
--      INSERT ... (..., data) VALUES (..., ::jsonb) contra una columna que
--      nunca se creó en prod → toda creación de evolución médica falla hoy con
--      'column "data" of relation "evolucion_medica" does not exist'.
--   2) Trigger BEFORE UPDATE/DELETE de inmutabilidad post-firma. A diferencia
--      de 145_historia_clinica_immutable_trigger (que lee OLD.estado_registro
--      local), aquí el estado de firma vive en el motor de workflow
--      (documento_instancia → flujo_estado), así que el trigger resuelve el
--      estado vía subquery. Defensa-en-profundidad sobre las 3 capas ya
--      existentes (router rechaza no-borrador + máquina de estados + audit
--      hash-chain). NTEC Art. 7 — integridad documental.
--
-- APLICAR: manualmente vía Supabase SQL Editor o mcp apply_migration.
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
-- =============================================================================

-- 1) Columna data ------------------------------------------------------------
ALTER TABLE ece.evolucion_medica
  ADD COLUMN IF NOT EXISTS data JSONB;

COMMENT ON COLUMN ece.evolucion_medica.data IS
  'CC-0006: payload estructurado del flujo modal-driven — { signosVitalesId?, '
  'problemas: [{id,texto,parentId,orden}], plan: [{id,texto,orden}], '
  'signos? (10 campos de signos vitales como strings, inline; sin fila '
  'ece.signos_vitales separada para evitar huérfanos en autosave) }. '
  'Las notas S/O/A y el plan numerado viven además en las columnas tipadas '
  'subjetivo/objetivo/analisis/plan (NTEC §3.8).';

-- 2) Inmutabilidad post-firma ------------------------------------------------
CREATE OR REPLACE FUNCTION ece.fn_evolucion_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ece, public, pg_catalog
AS $$
DECLARE
  v_estado TEXT;
BEGIN
  -- El estado de firma de la evolución vive en el motor de workflow.
  SELECT fe.codigo
    INTO v_estado
    FROM ece.documento_instancia di
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
   WHERE di.id = OLD.instancia_id;

  -- Estados post-firma bloquean toda mutación. 'borrador' y 'en_revision'
  -- siguen siendo mutables (el médico puede seguir editando / autosave).
  IF v_estado IN ('firmado', 'validado', 'anulado', 'certificado') THEN
    RAISE EXCEPTION
      'Evolución médica % no puede modificarse: estado post-firma ''%''. [CC-0006 NTEC Art. 7]',
      OLD.id, v_estado
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ece.fn_evolucion_immutable()
  IS 'CC-0006: bloquea UPDATE/DELETE en evolucion_medica post-firma (firmado/validado/anulado/certificado). NTEC Art. 7.';

DROP TRIGGER IF EXISTS trg_evolucion_immutable ON ece.evolucion_medica;
CREATE TRIGGER trg_evolucion_immutable
  BEFORE UPDATE OR DELETE ON ece.evolucion_medica
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_evolucion_immutable();

COMMENT ON TRIGGER trg_evolucion_immutable ON ece.evolucion_medica
  IS 'CC-0006: inmutabilidad evolución médica post-firma. NTEC Art. 7.';
