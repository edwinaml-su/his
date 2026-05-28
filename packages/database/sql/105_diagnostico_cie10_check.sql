-- =============================================================================
-- Migration: 105_diagnostico_cie10_check.sql
-- HC-004 (audit Stream B — P1 ALTA): ece.historia_clinica.diagnosticos es
-- JSONB sin validación de estructura CIE-10. Un insert directo puede omitir
-- el código CIE-10 completamente o usar formatos arbitrarios.
--
-- Estrategia: función SQL que valida el formato de cada elemento del array
-- JSONB y un CHECK constraint que la invoca.
--
-- Formato CIE-10 aceptado: letra mayúscula + 2 dígitos + subcategoría opcional
-- ej: A00, A00.0, B22.X, Z38.00
--
-- PENDIENTE DE APPLY MANUAL en Supabase SQL Editor / MCP apply_migration.
-- =============================================================================

-- Función de validación de array JSONB de diagnósticos CIE-10.
-- Acepta NULL (diagnosticos no obligatorio hasta que el médico firma).
-- Rechaza arrays vacíos o con elementos sin la clave "codigo" o con código
-- que no coincide con el patrón CIE-10.
CREATE OR REPLACE FUNCTION ece.fn_validate_diagnosticos_cie10(diagnosticos jsonb)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  elemento jsonb;
  codigo   text;
BEGIN
  IF diagnosticos IS NULL THEN
    RETURN TRUE;
  END IF;

  -- diagnosticos debe ser un array JSON.
  IF jsonb_typeof(diagnosticos) <> 'array' THEN
    RETURN FALSE;
  END IF;

  FOR elemento IN SELECT jsonb_array_elements(diagnosticos)
  LOOP
    -- Cada elemento debe tener la clave "codigo".
    IF elemento -> 'codigo' IS NULL THEN
      RETURN FALSE;
    END IF;

    codigo := elemento ->> 'codigo';

    -- Formato CIE-10: [A-Z][0-9]{2}(\.[0-9X]{1,4})?
    IF codigo !~ '^[A-Z][0-9]{2}(\.[0-9X]{1,4})?$' THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION ece.fn_validate_diagnosticos_cie10(jsonb)
  IS 'HC-004: valida que cada elemento de diagnosticos tenga "codigo" con formato CIE-10 ([A-Z][0-9]{2}(\.[0-9X]+)?).';

-- CHECK constraint que llama la función.
-- IF NOT EXISTS por idempotencia en re-runs.
ALTER TABLE ece.historia_clinica
  DROP CONSTRAINT IF EXISTS chk_hc_diagnosticos_cie10;

ALTER TABLE ece.historia_clinica
  ADD CONSTRAINT chk_hc_diagnosticos_cie10
  CHECK (ece.fn_validate_diagnosticos_cie10(diagnosticos));
