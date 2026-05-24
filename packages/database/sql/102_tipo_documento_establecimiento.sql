-- =============================================================================
-- 102_tipo_documento_establecimiento.sql
--
-- Fase 6 del workflow-designer enhancement: overrides por establecimiento.
--
-- Permite que cada establecimiento configure overrides operativos sobre los
-- tipos de documento NTEC sin alterar el catálogo central:
--
-- - `activo_override`: desactiva el tipo para este establecimiento (NULL = usar el
--   `tipo_documento.activo` global).
-- - `obligatorio_override`: BOOLEAN — si false, el wizard NO marca como LISTO
--   ni BLOQUEADO (queda como NO_APLICA). Si true o NULL, mantiene la
--   obligatoriedad global.
-- - `depende_de_override`: TEXT[] — si NO NULL, REEMPLAZA el `depende_de` global
--   solo para este establecimiento. Útil para hospitales que tienen reglas
--   operativas distintas (p.ej. un hospital de día sin emergencia no necesita
--   `TRIAJE` como dependencia de `ATN_EMERG`).
-- - `nota_dir`: TEXT — justificación del override por la dirección médica
--   (auditoría).
--
-- Quien puede editar: rol DIR del establecimiento. Toda escritura se audita
-- en `ece.bitacora_acceso`.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ece.tipo_documento_establecimiento (
  tipo_documento_id    uuid        NOT NULL REFERENCES ece.tipo_documento(id) ON DELETE CASCADE,
  establecimiento_id   uuid        NOT NULL REFERENCES ece.establecimiento(id) ON DELETE CASCADE,
  activo_override      boolean,
  obligatorio_override boolean,
  depende_de_override  text[],
  nota_dir             text        CHECK (nota_dir IS NULL OR length(nota_dir) <= 2000),
  creado_por           uuid        NOT NULL REFERENCES ece.personal_salud(id),
  creado_en            timestamptz NOT NULL DEFAULT now(),
  actualizado_por      uuid        REFERENCES ece.personal_salud(id),
  actualizado_en       timestamptz,
  PRIMARY KEY (tipo_documento_id, establecimiento_id)
);

CREATE INDEX IF NOT EXISTS idx_tipo_doc_estab_estab
  ON ece.tipo_documento_establecimiento(establecimiento_id);

CREATE INDEX IF NOT EXISTS idx_tipo_doc_estab_tipo
  ON ece.tipo_documento_establecimiento(tipo_documento_id);

COMMENT ON TABLE ece.tipo_documento_establecimiento IS
  'Fase 6: overrides operativos por establecimiento sobre tipos de documento NTEC. NULL en columnas *_override significa "usar valor global".';

COMMENT ON COLUMN ece.tipo_documento_establecimiento.activo_override IS
  'true = forzar activo aquí; false = forzar inactivo aquí; NULL = usar tipo_documento.activo global';

COMMENT ON COLUMN ece.tipo_documento_establecimiento.obligatorio_override IS
  'true = obligatorio; false = opcional (wizard lo trata como NO_APLICA); NULL = usar política global';

COMMENT ON COLUMN ece.tipo_documento_establecimiento.depende_de_override IS
  'REEMPLAZA tipo_documento.depende_de solo en este establecimiento. NULL = usar global.';

-- RLS — solo se puede leer/escribir el override del propio establecimiento.
ALTER TABLE ece.tipo_documento_establecimiento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tde_select_propio ON ece.tipo_documento_establecimiento;
CREATE POLICY tde_select_propio ON ece.tipo_documento_establecimiento
  FOR SELECT
  USING (establecimiento_id = ece.current_establecimiento_id());

DROP POLICY IF EXISTS tde_insert_dir ON ece.tipo_documento_establecimiento;
CREATE POLICY tde_insert_dir ON ece.tipo_documento_establecimiento
  FOR INSERT
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id());

DROP POLICY IF EXISTS tde_update_dir ON ece.tipo_documento_establecimiento;
CREATE POLICY tde_update_dir ON ece.tipo_documento_establecimiento
  FOR UPDATE
  USING (establecimiento_id = ece.current_establecimiento_id())
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id());

DROP POLICY IF EXISTS tde_delete_dir ON ece.tipo_documento_establecimiento;
CREATE POLICY tde_delete_dir ON ece.tipo_documento_establecimiento
  FOR DELETE
  USING (establecimiento_id = ece.current_establecimiento_id());

-- Helper para enforcement (Capa 2 — usado por el trigger BEFORE INSERT).
-- Devuelve el depende_de EFECTIVO (override o global) para un tipo_documento
-- en un establecimiento. NULL si tipo no existe.
CREATE OR REPLACE FUNCTION ece.fn_depende_de_efectivo(
  p_tipo_documento_id uuid,
  p_establecimiento_id uuid
) RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $func$
DECLARE
  v_override   text[];
  v_global     text[];
  v_obligatorio_override boolean;
BEGIN
  -- 1. Buscar override por establecimiento
  SELECT depende_de_override, obligatorio_override
    INTO v_override, v_obligatorio_override
    FROM ece.tipo_documento_establecimiento
   WHERE tipo_documento_id = p_tipo_documento_id
     AND establecimiento_id = p_establecimiento_id
   LIMIT 1;

  -- Si el establecimiento marcó el tipo como NO obligatorio → no enforce nada.
  IF v_obligatorio_override = false THEN
    RETURN '{}'::text[];
  END IF;

  -- Si hay override de depende_de, usarlo
  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  -- Fallback: depende_de global
  SELECT depende_de INTO v_global
    FROM ece.tipo_documento WHERE id = p_tipo_documento_id;

  RETURN COALESCE(v_global, '{}'::text[]);
END;
$func$;

COMMENT ON FUNCTION ece.fn_depende_de_efectivo IS
  'Fase 6: devuelve depende_de EFECTIVO para un tipo en un establecimiento. Aplica override si existe; respeta obligatorio_override=false como bypass total.';

-- Reescribir la función del trigger (Fase 4) para usar el override
CREATE OR REPLACE FUNCTION ece.fn_assert_dependencias_firmadas()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
DECLARE
  v_tipo_codigo  text;
  v_depende_de   text[];
  v_pendientes   text[];
  v_skip         text;
  v_estab_id     uuid;
BEGIN
  -- Bypass GUC
  BEGIN
    v_skip := current_setting('app.skip_dependencias_enforcement', true);
  EXCEPTION WHEN OTHERS THEN
    v_skip := NULL;
  END;
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  -- Establecimiento actual (de la sesión RLS)
  BEGIN
    v_estab_id := ece.current_establecimiento_id();
  EXCEPTION WHEN OTHERS THEN
    v_estab_id := NULL;
  END;

  -- Validar que el tipo existe
  SELECT codigo INTO v_tipo_codigo
    FROM ece.tipo_documento
   WHERE id = NEW.tipo_documento_id;
  IF v_tipo_codigo IS NULL THEN
    RAISE EXCEPTION 'tipo_documento_id % no existe', NEW.tipo_documento_id;
  END IF;

  -- depende_de EFECTIVO (respeta override por establecimiento si está disponible)
  IF v_estab_id IS NOT NULL THEN
    v_depende_de := ece.fn_depende_de_efectivo(NEW.tipo_documento_id, v_estab_id);
  ELSE
    SELECT depende_de INTO v_depende_de
      FROM ece.tipo_documento WHERE id = NEW.tipo_documento_id;
  END IF;

  IF v_depende_de IS NULL OR array_length(v_depende_de, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(td.codigo ORDER BY td.codigo)
    INTO v_pendientes
    FROM ece.tipo_documento td
   WHERE td.codigo = ANY(v_depende_de)
     AND td.activo = true
     AND NOT EXISTS (
       SELECT 1
         FROM ece.documento_instancia di
         JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE di.tipo_documento_id = td.id
          AND di.paciente_id = NEW.paciente_id
          AND di.estado_registro = 'vigente'
          AND (
            fe.es_final = true
            OR fe.codigo IN ('firmado', 'validado', 'certificado')
          )
          AND (
            NEW.episodio_id IS NULL
            OR di.episodio_id = NEW.episodio_id
          )
     );

  IF v_pendientes IS NULL OR array_length(v_pendientes, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'PRECONDITION_FAILED: No se puede crear documento_instancia de tipo % — faltan dependencias firmadas: %',
    v_tipo_codigo, array_to_string(v_pendientes, ', ')
    USING ERRCODE = '23514';
END;
$func$;

COMMIT;
