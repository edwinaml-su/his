-- =============================================================================
-- 145_historia_clinica_immutable_trigger.sql
-- HC-005 (audit Stream B 2026-05-19): trigger BEFORE UPDATE/DELETE que bloquea
-- cambios en ece.historia_clinica post-firma.
--
-- Contexto: NTEC Art. 7 — integridad documental de la Historia Clínica.
-- El hash-chain de audit_log detecta modificaciones pero no las previene.
-- Este trigger cierra el gap preventivo análogo a los triggers existentes en:
--   epicrisis, acto_quirurgico, certificado_defuncion, bedside_validation.
--
-- Estados que activan el bloqueo: firmado, validado, anulado.
-- Estado 'borrador' y 'en_revision' siguen siendo mutables.
--
-- APLICAR: manualmente via Supabase SQL Editor o mcp__supabase__execute_sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION ece.fn_hc_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Bloquea UPDATE y DELETE cuando el documento ya fue firmado/validado/anulado.
  -- 'borrador' y 'en_revision' son mutables (el médico puede seguir editando).
  IF OLD.estado_registro IN ('firmado', 'validado', 'anulado', 'FIRMADO', 'VALIDADO', 'ANULADO') THEN
    RAISE EXCEPTION
      'Historia Clínica % no puede modificarse: estado post-firma ''%''. [HC-005 NTEC Art. 7]',
      OLD.id, OLD.estado_registro
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ece.fn_hc_immutable()
  IS 'HC-005 (audit 2026-05-19): bloquea UPDATE/DELETE en historia_clinica post-firma. NTEC Art. 7.';

-- Trigger BEFORE UPDATE — previene modificación de campos clínicos post-firma.
DROP TRIGGER IF EXISTS trg_hc_immutable ON ece.historia_clinica;
CREATE TRIGGER trg_hc_immutable
  BEFORE UPDATE OR DELETE ON ece.historia_clinica
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_hc_immutable();

COMMENT ON TRIGGER trg_hc_immutable ON ece.historia_clinica
  IS 'HC-005: inmutabilidad Historia Clínica post-firma (firmado/validado/anulado). NTEC Art. 7.';
