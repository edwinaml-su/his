-- =====================================================================
-- 99_acto_quirurgico_trigger_condicional.sql
-- Remediación HE-06 (Sprint S4 Stream E)
--
-- HE-06: Reemplaza fn_bloquea_mutacion genérica (incondicional) por
--        fn_bloquea_mutacion_acto_qx condicional — solo bloquea
--        UPDATE/DELETE cuando el estado del workflow (via documento_instancia
--        + flujo_estado) es 'firmado', 'validado' o 'anulado'.
--        En 'borrador' permite mutaciones necesarias para el flujo previo
--        a firma (Art. 40 NTEC).
--
-- Nota: estado_registro en acto_quirurgico solo tiene 'vigente'/'rectificado'
--       (campo de auditoría de registro). El estado del workflow vive en
--       ece.documento_instancia -> ece.flujo_estado.codigo.
--
-- Patrón idéntico al aplicado en:
--   - Epicrisis A-05 (PR #176)
--   - Consentimiento C-01 (PR #177 / 99_consentimiento_doble_firma_workflow.sql)
-- =====================================================================

-- Función condicional específica para acto_quirurgico
CREATE OR REPLACE FUNCTION ece.fn_bloquea_mutacion_acto_qx()
RETURNS trigger AS $$
DECLARE
  v_estado_codigo text;
BEGIN
  -- Leer estado actual del workflow via documento_instancia
  SELECT fe.codigo INTO v_estado_codigo
  FROM ece.documento_instancia di
  JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
  WHERE di.id = OLD.instancia_id;

  -- Solo bloquear si el documento ya fue firmado, validado o anulado
  IF v_estado_codigo IN ('firmado', 'validado', 'anulado') THEN
    RAISE EXCEPTION 'mutacion_no_permitida: acto quirúrgico en estado ''%'' es inmutable (Art. 40 NTEC)', v_estado_codigo
      USING ERRCODE = '2F003';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reemplazar trigger incondicional por la versión condicional
DROP TRIGGER IF EXISTS trg_inmutable_acto_quirurgico ON ece.acto_quirurgico;

CREATE TRIGGER trg_inmutable_acto_quirurgico
  BEFORE UPDATE OR DELETE ON ece.acto_quirurgico
  FOR EACH ROW EXECUTE FUNCTION ece.fn_bloquea_mutacion_acto_qx();
