-- =============================================================================
-- Migración 115 — SBAR handoff column
-- JCI Standard: IPSG.2 ME 4 — Structured handoff communication
-- =============================================================================
-- Agrega columna sbar (JSONB) a ece.registro_enfermeria para registrar
-- el handoff estructurado al cierre de turno de enfermería.
--
-- Estructura esperada (sin enforcement SQL — Zod valida en capa de aplicación):
--   {
--     situation:      string  (min 10, max 2000)
--     background:     string  (min 10, max 2000)
--     assessment:     string  (min 10, max 2000)
--     recommendation: string  (min 10, max 2000)
--   }
--
-- El campo es opcional: no todos los cierres de turno son handoff inter-turno.
-- La capa de aplicación emite warning cuando sbar IS NULL y el paciente
-- tiene complexidad alta (UCI) o episodio activo.
-- =============================================================================

ALTER TABLE ece.registro_enfermeria
  ADD COLUMN IF NOT EXISTS sbar JSONB;

COMMENT ON COLUMN ece.registro_enfermeria.sbar IS
  'Handoff SBAR al cierre de turno. '
  'JCI IPSG.2 ME 4. '
  'Estructura: {situation, background, assessment, recommendation}. '
  'Opcional — warning en app cuando paciente activo y sbar IS NULL.';
