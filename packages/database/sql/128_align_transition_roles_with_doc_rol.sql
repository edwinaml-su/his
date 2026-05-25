-- =============================================================================
-- 128_align_transition_roles_with_doc_rol.sql
-- Alinear flujo_transicion.rol_autoriza_id con la matriz documento_rol.
--
-- Bug detectado en auditoría 2026-05-25: las transiciones de los 12 tipos
-- especializados usaban "MC" genérico para acción "firmar", pero según NTEC:
--   - VAL_INI_ENF: firma enfermería (ENF), no médico cabecera.
--   - PARTOGRAMA/SALA_EXP: firma gineco (ESP).
--   - ATN_RN/NRP: firma pediatra/neonatólogo (ESP).
--   - PREOP_CHECK/REG_ANEST/WHO_CHK: firma anestesiólogo/cirujano (ESP).
--   - PROG_QX/CONS_QX: firma cirujano (ESP).
--   - RES_EST: firma lector/patólogo (ESP).
--
-- Impacto: con el rol mal asignado, el motor de workflow rechaza la firma
-- ("usuario no tiene permiso de transición") aunque el usuario sí tenga el
-- rol institucional correcto.
--
-- Reglas aplicadas (UPDATE solo si distinto, idempotente):
--   - accion='firmar'           → rol = FIRMA del documento_rol
--   - accion='enviar_revision'  → rol = LLENA del documento_rol
--   - accion='validar'          → rol = AUTORIZA del documento_rol
--   - accion='anular'           → DIR (siempre — no se toca)
--   - accion='dar_alta' (URPA)  → ESP (se mantiene como anestesiólogo)
--
-- Aplicado a prod 2026-05-25 vía MCP (migration:
--   align_transition_roles_with_doc_rol_2026_05_25).
-- =============================================================================

WITH tipos_target(codigo) AS (VALUES
  ('VAL_INI_ENF'), ('PARTOGRAMA'), ('SALA_EXPULSION'),
  ('ATN_RN'), ('NRP'), ('PREOP_CHECK'),
  ('WHO_CHK'), ('PROG_QX'), ('CONS_QX'),
  ('REG_ANEST'), ('URPA'), ('RES_EST')
),
rol_por_funcion AS (
  SELECT DISTINCT ON (dr.tipo_documento_id, dr.funcion)
    dr.tipo_documento_id,
    dr.funcion,
    dr.rol_id
  FROM ece.documento_rol dr
  JOIN ece.tipo_documento td ON td.id = dr.tipo_documento_id
  WHERE td.codigo IN (SELECT codigo FROM tipos_target)
  ORDER BY dr.tipo_documento_id, dr.funcion, dr.rol_id
)
UPDATE ece.flujo_transicion ft
SET rol_autoriza_id = COALESCE(
  CASE ft.accion
    WHEN 'firmar'          THEN (SELECT rol_id FROM rol_por_funcion rpf
                                  WHERE rpf.tipo_documento_id = ft.tipo_documento_id
                                    AND rpf.funcion = 'FIRMA')
    WHEN 'enviar_revision' THEN (SELECT rol_id FROM rol_por_funcion rpf
                                  WHERE rpf.tipo_documento_id = ft.tipo_documento_id
                                    AND rpf.funcion = 'LLENA')
    WHEN 'validar'         THEN (SELECT rol_id FROM rol_por_funcion rpf
                                  WHERE rpf.tipo_documento_id = ft.tipo_documento_id
                                    AND rpf.funcion = 'AUTORIZA')
    ELSE ft.rol_autoriza_id
  END,
  ft.rol_autoriza_id
)
WHERE ft.tipo_documento_id IN (
  SELECT id FROM ece.tipo_documento WHERE codigo IN (SELECT codigo FROM tipos_target)
)
AND ft.accion IN ('firmar', 'enviar_revision', 'validar');
