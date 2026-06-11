-- 166_solicitud_arco_rectificacion_campos.sql
--
-- Agrega los campos de dominio de rectificación a ece.solicitud_arco.
-- ece.solicitud_arco es la tabla de estado del flujo ARCO (workflow).
-- ece.rectificacion es el registro inmutable append-only que se crea al APROBAR.
--
-- El router ece-rectificacion operaba contra un esquema imaginario con columnas
-- que no existen en ninguna tabla real. Este DDL alinea solicitud_arco con
-- el contrato de UI sin alterar ece.rectificacion (append-only, estructura NTEC).
--
-- Columnas añadidas a ece.solicitud_arco:
--   documento_instancia_id  — UUID del documento firmado objetivo (nullable para
--                             solicitudes ARCO de otros tipos que no apuntan a doc)
--   solicitante_id          — UUID del usuario HIS (public."User".id) que abrió la solicitud
--   campo                   — nombre del campo a rectificar (null para tipos no RECT)
--   valor_anterior          — valor original que se desea corregir
--   valor_propuesto         — valor nuevo propuesto
--   motivo_rechazo          — alias de motivo_respuesta para queries de rectificación
--                             (NO es columna nueva — es solo un alias en las queries)
--
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.

ALTER TABLE ece.solicitud_arco
  ADD COLUMN IF NOT EXISTS documento_instancia_id uuid,
  ADD COLUMN IF NOT EXISTS solicitante_id         uuid,
  ADD COLUMN IF NOT EXISTS campo                  text,
  ADD COLUMN IF NOT EXISTS valor_anterior         text,
  ADD COLUMN IF NOT EXISTS valor_propuesto        text;

-- Índice para listar solicitudes por documento instancia (cola de rectificaciones).
CREATE INDEX IF NOT EXISTS idx_solicitud_arco_doc_inst
  ON ece.solicitud_arco (documento_instancia_id)
  WHERE documento_instancia_id IS NOT NULL;

-- Índice para listar solicitudes por solicitante.
CREATE INDEX IF NOT EXISTS idx_solicitud_arco_solicitante
  ON ece.solicitud_arco (solicitante_id)
  WHERE solicitante_id IS NOT NULL;
