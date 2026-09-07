-- =============================================================================
-- 217_ece_paciente_espacio_b.sql — ADR 0022 (P0-5 Code Castle), migración de
-- datos: ece.paciente.establecimiento_id pasa del espacio A
-- (public."Establishment".id) al espacio B (ece.establecimiento.id), que es
-- el que usan las otras 15+ tablas ece.* y el que ahora garantiza el GUC
-- (sql/216 resuelve el puente en ece.set_ece_context).
--
-- ece.documento_instancia no requiere cambio: su policy hace JOIN a
-- ece.paciente y hereda el espacio transitivamente (ADR 0022 §4).
--
-- ⚠️ SECUENCIA: aplicar JUNTO con sql/216 e inmediatamente DESPUÉS del deploy
-- del código (applyWorkflowContext → set_ece_context). Aplicado antes del
-- deploy, los routers que aún setean el GUC a mano (espacio A) pierden
-- lectura de ece.paciente/documento_instancia hasta que el deploy complete.
--
-- Aborta (excepción, rollback) si alguna fila queda sin resolver — p. ej. un
-- Establishment sin fila puente en ece.establecimiento (ADR 0022 §Riesgos:
-- verificar el 1:1 antes de aplicar si se provisionó un establecimiento
-- nuevo desde 2026-08-22).
--
-- Idempotente: filas ya en espacio B no matchean el UPDATE y la FK se
-- recrea solo si apunta al destino viejo.
-- =============================================================================

DO $$
DECLARE
  v_target regclass;
  v_sin_resolver int;
BEGIN
  SELECT confrelid::regclass INTO v_target
  FROM pg_constraint
  WHERE conname = 'paciente_establecimiento_id_fkey'
    AND conrelid = 'ece.paciente'::regclass;

  IF v_target IS NOT NULL AND v_target::text <> 'ece.establecimiento' THEN
    ALTER TABLE ece.paciente DROP CONSTRAINT paciente_establecimiento_id_fkey;
    v_target := NULL;
  END IF;

  -- Re-mapear espacio A → B vía la columna puente (1:1, ADR 0022 §2).
  UPDATE ece.paciente p
     SET establecimiento_id = e.id
    FROM ece.establecimiento e
   WHERE e.establishment_id = p.establecimiento_id;

  SELECT count(*) INTO v_sin_resolver
  FROM ece.paciente p
  WHERE NOT EXISTS (
    SELECT 1 FROM ece.establecimiento e WHERE e.id = p.establecimiento_id);

  IF v_sin_resolver > 0 THEN
    RAISE EXCEPTION 'sql/217: % filas de ece.paciente sin resolver al espacio ece.establecimiento — falta fila puente. Rollback.',
      v_sin_resolver;
  END IF;

  IF v_target IS NULL THEN
    ALTER TABLE ece.paciente
      ADD CONSTRAINT paciente_establecimiento_id_fkey
      FOREIGN KEY (establecimiento_id) REFERENCES ece.establecimiento(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN ece.paciente.establecimiento_id IS
  'FK a ece.establecimiento(id) — espacio B unificado (ADR 0022, sql/217). '
  'Antes referenciaba public."Establishment"(id); el puente vive en '
  'ece.establecimiento.establishment_id.';
