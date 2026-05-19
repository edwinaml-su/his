-- =====================================================================
-- 99_consentimiento_doble_firma_workflow.sql
-- Remediación C-01 / C-03 / C-04 (Sprint S2-Tier4)
--
-- C-04: Añadir columna `estado` para que la inmutabilidad sea condicional.
-- C-03: Añadir columnas para firma del médico cirujano (Art. 39 NTEC).
-- C-01: Reemplazar fn_bloquea_mutacion con versión condicional (solo
--       bloquea cuando estado IN ('firmado','revocado')).
-- Extra: firmanteRol/Nombre/Documento → nullable (se completan en
--        firmarPaciente, no en create).
--
-- Aplicado vía mcp__supabase__apply_migration el 2026-05-19.
-- Idempotente: IF NOT EXISTS / CREATE OR REPLACE.
-- =====================================================================

-- C-04: estado explícito (requerido para condición en trigger)
ALTER TABLE ece.consentimiento_informado
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador','firmado','revocado'));

-- C-03: firma del médico cirujano (doble firma Art. 39 NTEC)
ALTER TABLE ece.consentimiento_informado
  ADD COLUMN IF NOT EXISTS firma_mc_id            UUID,
  ADD COLUMN IF NOT EXISTS firma_mc_en            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidencia_firma_mc_ref TEXT;

-- Corrección de NOT NULL incorrectos: firmante_* se completan
-- en firmarPaciente, no en el INSERT de create. El borrador no tiene
-- firmante todavía.
ALTER TABLE ece.consentimiento_informado
  ALTER COLUMN firmante_rol       DROP NOT NULL,
  ALTER COLUMN firmante_nombre    DROP NOT NULL,
  ALTER COLUMN firmante_documento DROP NOT NULL;

-- C-01: Función específica para consentimiento_informado (condicional).
-- La fn_bloquea_mutacion genérica sigue activa para las demás tablas
-- (bitacora_acceso, epicrisis, certificado_defuncion, etc.).
CREATE OR REPLACE FUNCTION ece.fn_bloquea_mutacion_consentimiento()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Solo bloquear si el documento ya está firmado o revocado (Art. 40 NTEC).
  -- En estado 'borrador', las mutaciones son necesarias para registrar firmas.
  IF OLD.estado IN ('firmado', 'revocado') THEN
    RAISE EXCEPTION
      'mutacion_no_permitida: consentimiento informado en estado ''%'' es inmutable (Art. 40 NTEC). '
      'Use el flujo de rectificación para correcciones.',
      OLD.estado;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ece.fn_bloquea_mutacion_consentimiento() IS
  'Trigger BEFORE UPDATE OR DELETE para ece.consentimiento_informado. '
  'Bloquea mutaciones solo post-firma (estado firmado o revocado). '
  'En borrador permite UPDATE para registrar firmas (Art. 39 NTEC doble firma). '
  'Reemplaza fn_bloquea_mutacion genérica para esta tabla (C-01 remediación).';

-- Reemplazar trigger genérico por el específico condicional
DROP TRIGGER IF EXISTS trg_inmutable_consentimiento_informado ON ece.consentimiento_informado;

CREATE TRIGGER trg_inmutable_consentimiento_informado
  BEFORE UPDATE OR DELETE ON ece.consentimiento_informado
  FOR EACH ROW EXECUTE FUNCTION ece.fn_bloquea_mutacion_consentimiento();

-- Índice para búsquedas por estado (firma pendiente MC, dashboards)
CREATE INDEX IF NOT EXISTS idx_consentimiento_estado
  ON ece.consentimiento_informado (estado)
  WHERE estado != 'borrador';
