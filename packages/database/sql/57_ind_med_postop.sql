-- 57_ind_med_postop.sql
-- IND_MED_POSTOP — Indicaciones Médicas Post-Operatorias.
--
-- Documento NTEC específico para indicaciones de administración de
-- medicamentos en el post-quirúrgico. Depende explícitamente de
-- `ACTO_QX` (Acta Quirúrgica / Nota Operatoria). NO se modifica el
-- `IND_MED` genérico — usar este tipo cuando el episodio sea quirúrgico
-- y la indicación derive del reporte post-op.
--
-- Diseño:
--   • Misma `tabla_datos = indicaciones_medicas` que IND_MED (mismo payload
--     físico). El motor de workflow las diferencia por `tipo_documento_id`.
--   • Mismo set de estados (borrador → en_revision → firmado → validado).
--   • `depende_de = ARRAY['ACTO_QX']` ← bloqueo dependiente, enforzado por
--     `ece.fn_assert_dependencias_firmadas` (sql/05x) y el helper
--     TS `assertDependenciasFirmadas`.
--
-- Idempotente: usa `ON CONFLICT (codigo) DO NOTHING`.

DO $$
DECLARE
  v_postop_id  uuid;
  v_borrador   uuid;
  v_revision   uuid;
  v_firmado    uuid;
  v_validado   uuid;
  v_anulado    uuid;
  v_rol_med    uuid;
BEGIN
  -- 1) Insertar el tipo (idempotente).
  INSERT INTO ece.tipo_documento
    (codigo, nombre, tabla_datos, tipo_registro, modalidad,
     depende_de, inmutable, activo, descripcion_markdown)
  VALUES
    ('IND_MED_POSTOP',
     'Indicaciones Médicas Post-Operatorias',
     'indicaciones_medicas',
     'transaccional',
     'hospitalario',
     ARRAY['ACTO_QX']::text[],
     false,
     true,
     '# IND_MED_POSTOP — Indicaciones Médicas Post-Operatorias' || E'\n\n'
     || 'Indicaciones médicas para administración de medicamentos derivadas' || E'\n'
     || 'del reporte post-operatorio (Acta Quirúrgica / Nota Operatoria, NTEC' || E'\n'
     || 'Art. 30). NO se permite crear este documento sin la firma previa de' || E'\n'
     || '`ACTO_QX` para el episodio.' || E'\n\n'
     || '## Diferencia con IND_MED' || E'\n\n'
     || '`IND_MED` cubre indicaciones genéricas (ambulatorio + hospitalario)' || E'\n'
     || 'sin dependencia quirúrgica. `IND_MED_POSTOP` es el sub-tipo que' || E'\n'
     || 'aplica únicamente cuando hay un acto quirúrgico de referencia.' || E'\n'
    )
  ON CONFLICT (codigo) DO NOTHING;

  SELECT id INTO v_postop_id FROM ece.tipo_documento WHERE codigo = 'IND_MED_POSTOP';
  IF v_postop_id IS NULL THEN
    RAISE EXCEPTION 'IND_MED_POSTOP no se pudo insertar/leer';
  END IF;

  -- 2) Estados (mismos 5 del workflow genérico).
  INSERT INTO ece.flujo_estado (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
  VALUES
    (v_postop_id, 'borrador',    'Borrador',    true,  false, 1),
    (v_postop_id, 'en_revision', 'En revisión', false, false, 2),
    (v_postop_id, 'firmado',     'Firmado',     false, false, 3),
    (v_postop_id, 'validado',    'Validado',    false, true,  4),
    (v_postop_id, 'anulado',     'Anulado',     false, false, 9)
  ON CONFLICT (tipo_documento_id, codigo) DO NOTHING;

  -- 3) Cargar IDs de estados (necesarios para transiciones).
  SELECT id INTO v_borrador  FROM ece.flujo_estado WHERE tipo_documento_id = v_postop_id AND codigo = 'borrador';
  SELECT id INTO v_revision  FROM ece.flujo_estado WHERE tipo_documento_id = v_postop_id AND codigo = 'en_revision';
  SELECT id INTO v_firmado   FROM ece.flujo_estado WHERE tipo_documento_id = v_postop_id AND codigo = 'firmado';
  SELECT id INTO v_validado  FROM ece.flujo_estado WHERE tipo_documento_id = v_postop_id AND codigo = 'validado';
  SELECT id INTO v_anulado   FROM ece.flujo_estado WHERE tipo_documento_id = v_postop_id AND codigo = 'anulado';

  -- 4) Rol médico (mismo que IND_MED — el médico tratante autoriza).
  -- Reutilizamos el rol_autoriza_id de IND_MED.borrador→en_revision si existe.
  SELECT ft.rol_autoriza_id INTO v_rol_med
  FROM   ece.flujo_transicion ft
  JOIN   ece.tipo_documento td ON td.id = ft.tipo_documento_id
  WHERE  td.codigo = 'IND_MED' AND ft.accion = 'enviar_revision'
  LIMIT 1;

  -- 5) Transiciones (mismas que IND_MED, NOT a IND_MED_POSTOP).
  INSERT INTO ece.flujo_transicion
    (tipo_documento_id, estado_origen_id, estado_destino_id, accion, rol_autoriza_id, requiere_firma)
  VALUES
    (v_postop_id, v_borrador, v_revision, 'enviar_revision', v_rol_med, false),
    (v_postop_id, v_borrador, v_anulado,  'anular',          v_rol_med, true),
    (v_postop_id, v_revision, v_firmado,  'firmar',          v_rol_med, true),
    (v_postop_id, v_firmado,  v_validado, 'validar',         v_rol_med, false)
  ON CONFLICT (tipo_documento_id, estado_origen_id, accion) DO NOTHING;

END $$;
