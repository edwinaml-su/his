-- =============================================================================
-- 146_indicacion_motivo_omision_check.sql
-- IND-004 (audit Stream B 2026-05-19): CHECK condicional en
-- ece.administracion_medicamento — si estado='OMITIDA'|'RECHAZADA',
-- motivo_omision debe ser NOT NULL.
--
-- Contexto: NTEC exige documentar el motivo de toda omisión de medicación.
-- Sin este constraint, es posible registrar una omisión sin motivo en BD.
-- La validación Zod en el router protege en tiempo de ejecución, pero no
-- ante inserciones directas o seeds.
--
-- APLICAR: manualmente via Supabase SQL Editor o mcp__supabase__execute_sql.
-- =============================================================================

-- CHECK condicional: si el estado indica omisión o rechazo, el motivo es requerido.
-- Los estados exactos deben coincidir con el enum usado en el router indicaciones-medicas.
ALTER TABLE ece.administracion_medicamento
  ADD CONSTRAINT chk_motivo_omision_requerido
  CHECK (
    estado NOT IN ('OMITIDA', 'RECHAZADA', 'omitida', 'rechazada')
    OR motivo_omision IS NOT NULL
  );

COMMENT ON CONSTRAINT chk_motivo_omision_requerido ON ece.administracion_medicamento
  IS 'IND-004 (audit 2026-05-19): NTEC — motivo_omision es obligatorio cuando estado = OMITIDA|RECHAZADA.';
