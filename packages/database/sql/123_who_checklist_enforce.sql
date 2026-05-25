-- =============================================================================
-- Migración 119: WHO Safety Checklist enforcement — IPSG.4 ME 3
-- US.JCI.5.13 — El acto quirúrgico NO puede transicionar a estado final sin
-- tener las 3 pausas del WHO Safety Checklist completadas (estado = 'completo').
--
-- Modelo real (verificado vía MCP 2026-05-24):
--   ece.documento_instancia_historial (INSERT) → estado_nuevo_id → ece.flujo_estado.es_final
--   ece.documento_instancia.registro_id → ece.acto_quirurgico.id  (polimórfico)
--   ece.acto_quirurgico.instancia_id → ece.documento_instancia.id (inversa)
--   ece.who_checklist.acto_quirurgico_id → ece.acto_quirurgico.id
--   ece.who_checklist.estado CHECK IN ('iniciado','sign_in_completo','time_out_completo','completo')
--   ece.tipo_documento.codigo = 'ACTO_QX' para acotar el trigger solo a actos quirúrgicos
--
-- ERRCODE 23514 = check_violation (semánticamente correcto para precondición de integridad)
-- =============================================================================

CREATE OR REPLACE FUNCTION ece.fn_assert_who_checklist_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_es_final        boolean;
  v_tipo_codigo     text;
  v_acto_id         uuid;
  v_who_estado      text;
BEGIN
  -- 1. ¿El estado destino es un estado final del flujo?
  SELECT fe.es_final
    INTO v_es_final
    FROM ece.flujo_estado fe
   WHERE fe.id = NEW.estado_nuevo_id;

  IF v_es_final IS NULL OR NOT v_es_final THEN
    RETURN NEW;  -- transición intermedia, no aplica
  END IF;

  -- 2. ¿La instancia corresponde a un Acto Quirúrgico (ACTO_QX)?
  SELECT td.codigo
    INTO v_tipo_codigo
    FROM ece.documento_instancia di
    JOIN ece.tipo_documento td ON td.id = di.tipo_documento_id
   WHERE di.id = NEW.instancia_id;

  IF v_tipo_codigo IS DISTINCT FROM 'ACTO_QX' THEN
    RETURN NEW;  -- otro tipo de documento, no aplica
  END IF;

  -- 3. Obtener el acto_quirurgico vinculado a esta instancia
  SELECT aq.id
    INTO v_acto_id
    FROM ece.acto_quirurgico aq
   WHERE aq.instancia_id = NEW.instancia_id
   LIMIT 1;

  IF v_acto_id IS NULL THEN
    RAISE EXCEPTION
      'PRECONDITION_FAILED: IPSG4_ACTO_QX_NOT_FOUND — No se encontró acto quirúrgico para la instancia %',
      NEW.instancia_id
      USING ERRCODE = '23514';
  END IF;

  -- 4. Verificar WHO Checklist existe y está completo
  SELECT wc.estado
    INTO v_who_estado
    FROM ece.who_checklist wc
   WHERE wc.acto_quirurgico_id = v_acto_id
   LIMIT 1;

  IF v_who_estado IS NULL THEN
    RAISE EXCEPTION
      'PRECONDITION_FAILED: IPSG4_WHO_CHECKLIST_MISSING — WHO Safety Checklist no existe para el acto quirúrgico %',
      v_acto_id
      USING ERRCODE = '23514';
  END IF;

  IF v_who_estado <> 'completo' THEN
    RAISE EXCEPTION
      'PRECONDITION_FAILED: IPSG4_WHO_CHECKLIST_INCOMPLETE — Las 3 pausas del WHO deben estar completas (Sign-In, Time-Out, Sign-Out). Estado actual: %',
      v_who_estado
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ece.fn_assert_who_checklist_complete() IS
  'JCI IPSG.4 ME 3 — US.JCI.5.13: Impide cerrar (estado final) un Acto Quirúrgico sin WHO Safety Checklist completo (Sign-In + Time-Out + Sign-Out).';

-- -----------------------------------------------------------------------------
-- Trigger sobre documento_instancia_historial BEFORE INSERT
-- Se dispara cuando se registra una transición de workflow hacia estado final.
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_who_checklist_enforce ON ece.documento_instancia_historial;

CREATE TRIGGER trg_who_checklist_enforce
  BEFORE INSERT ON ece.documento_instancia_historial
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_assert_who_checklist_complete();

COMMENT ON TRIGGER trg_who_checklist_enforce ON ece.documento_instancia_historial IS
  'JCI IPSG.4 ME 3 — Bloquea transición a estado final de ACTO_QX sin WHO Checklist completo.';
