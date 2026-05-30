-- =============================================================================
-- Migración 159 — SBAR handoff trigger IPSG.2-H3
-- JCI Standard: IPSG.2 ME 4 — Structured handoff communication
--
-- Contexto: sql/115 agregó la columna `sbar JSONB` a ece.registro_enfermeria
-- como OPCIONAL. El surveyor JCI exige que TODO cierre de turno (estado
-- 'en_revision') tenga SBAR estructurado con S/A/R mínimos.
--
-- Estrategia de enforcement (defensa en profundidad):
--   1. Capa Zod (router tRPC)   — primer rechazo, user-friendly
--   2. Trigger BD (este archivo) — último recurso, bloquea bypasses directos
--
-- El trigger SOLO actúa cuando:
--   NEW.estado_registro = 'en_revision'   (cerrarTurno activa este estado)
--   Y NEW.sbar IS NULL
--      O alguno de S/A/R tiene menos de 5 chars
--
-- Background es verificado pero solo emite NOTICE (opcional para JCI).
-- El trigger NO actúa en updates que dejen estado_registro != 'en_revision',
-- protegiendo operaciones previas (firmar, validar, etc.).
-- =============================================================================

SET search_path TO ece, public;

-- ---------------------------------------------------------------------------
-- Función trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.fn_validate_sbar_handoff()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ece, public
AS $$
DECLARE
  v_situation      text;
  v_assessment     text;
  v_recommendation text;
  v_background     text;
BEGIN
  -- Solo actúa cuando el registro avanza a 'en_revision' (cierre de turno).
  -- Cualquier otro estado (borrador, firmado, validado) pasa sin validación SBAR.
  IF NEW.estado_registro IS DISTINCT FROM 'en_revision' THEN
    RETURN NEW;
  END IF;

  -- Si el anterior estado ya era 'en_revision' y el UPDATE no toca sbar,
  -- mantener el valor existente y no re-validar (idempotencia).
  IF OLD IS NOT NULL
     AND OLD.estado_registro = 'en_revision'
     AND NEW.sbar IS NOT DISTINCT FROM OLD.sbar THEN
    RETURN NEW;
  END IF;

  -- Extraer campos del JSONB
  v_situation      := trim(NEW.sbar->>'situation');
  v_assessment     := trim(NEW.sbar->>'assessment');
  v_recommendation := trim(NEW.sbar->>'recommendation');
  v_background     := trim(NEW.sbar->>'background');

  -- Validar presencia de S/A/R (mínimo 5 caracteres después de trim)
  IF NEW.sbar IS NULL
     OR length(coalesce(v_situation,      '')) < 5
     OR length(coalesce(v_assessment,     '')) < 5
     OR length(coalesce(v_recommendation, '')) < 5
  THEN
    RAISE EXCEPTION
      'JCI IPSG.2: cierre de turno requiere SBAR completo (S/A/R) cuando hay paciente activo. '
      'Campos requeridos: situation (>=5 chars), assessment (>=5 chars), recommendation (>=5 chars). '
      'registro_enfermeria.id = %', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Background es opcional pero recomendado — emitir NOTICE sin bloquear
  IF length(coalesce(v_background, '')) < 5 THEN
    RAISE NOTICE
      'JCI IPSG.2 NOTICE: campo background ausente o breve en registro_enfermeria.id=%. '
      'Se recomienda documentar el contexto clínico del paciente.', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ece.fn_validate_sbar_handoff() IS
  'Trigger BEFORE INSERT OR UPDATE en ece.registro_enfermeria. '
  'Valida SBAR completo (S/A/R) cuando estado_registro = ''en_revision''. '
  'JCI IPSG.2 ME 4. Migración 159.';

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_validate_sbar_handoff ON ece.registro_enfermeria;

CREATE TRIGGER trg_validate_sbar_handoff
  BEFORE INSERT OR UPDATE ON ece.registro_enfermeria
  FOR EACH ROW EXECUTE FUNCTION ece.fn_validate_sbar_handoff();

COMMENT ON TRIGGER trg_validate_sbar_handoff ON ece.registro_enfermeria IS
  'JCI IPSG.2 ME 4 — enforce SBAR estructurado al cierre de turno enfermería. '
  'Migración 159.';
