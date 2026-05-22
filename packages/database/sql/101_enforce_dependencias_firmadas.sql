-- =============================================================================
-- 101_enforce_dependencias_firmadas.sql
--
-- Fase 4 del workflow-designer enhancement.
--
-- Defensa en profundidad: trigger BEFORE INSERT en `ece.documento_instancia`
-- que valida que todas las dependencias declaradas en
-- `tipo_documento.depende_de` tengan al menos una instancia firmada en el
-- mismo episodio (o paciente, si el documento es de nivel maestro).
--
-- Política de "firmado":
--   Un documento se considera firmado si su estado_actual:
--     - tiene es_final = true (terminal del workflow), O
--     - codigo IN ('firmado', 'validado', 'certificado')
--   Los estados 'borrador', 'en_revision', 'anulado' NO cuentan.
--
-- Política de scoping:
--   - Si NEW.episodio_id IS NOT NULL → buscar dependencias en el mismo episodio
--     + mismo paciente.
--   - Si NEW.episodio_id IS NULL → buscar dependencias a nivel paciente
--     (documentos maestros como FICHA_ID).
--
-- Bypass (uso interno):
--   - Si la sesión tiene la GUC `app.skip_dependencias_enforcement = 'true'`
--     el trigger no valida nada. Los seeders y migraciones deben setearla:
--
--     SET LOCAL app.skip_dependencias_enforcement = 'true';
--
-- Error mode:
--   - Si falta una dependencia: RAISE EXCEPTION con SQLSTATE '42501'
--     (insufficient_privilege) y mensaje listando los códigos pendientes.
--   - El cliente tRPC lo recibe como TRPCError code='INTERNAL_SERVER_ERROR'
--     pero el helper TS `assertDependenciasFirmadas` captura el caso ANTES
--     y devuelve PRECONDITION_FAILED con mensaje claro.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION ece.fn_assert_dependencias_firmadas()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
DECLARE
  v_tipo_codigo  text;
  v_depende_de   text[];
  v_pendientes   text[];
  v_skip         text;
BEGIN
  -- Bypass por GUC de sesión (seeders, migraciones, procesos administrativos)
  BEGIN
    v_skip := current_setting('app.skip_dependencias_enforcement', true);
  EXCEPTION WHEN OTHERS THEN
    v_skip := NULL;
  END;

  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  -- Cargar el tipo_documento y su depende_de
  SELECT codigo, depende_de
    INTO v_tipo_codigo, v_depende_de
    FROM ece.tipo_documento
   WHERE id = NEW.tipo_documento_id;

  IF v_tipo_codigo IS NULL THEN
    RAISE EXCEPTION 'tipo_documento_id % no existe', NEW.tipo_documento_id;
  END IF;

  -- Sin dependencias declaradas → permitir
  IF v_depende_de IS NULL OR array_length(v_depende_de, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Calcular qué dependencias NO tienen instancia firmada en el mismo episodio/paciente
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

  -- Hay dependencias pendientes — bloquear el INSERT
  RAISE EXCEPTION
    'PRECONDITION_FAILED: No se puede crear documento_instancia de tipo % — faltan dependencias firmadas: %',
    v_tipo_codigo, array_to_string(v_pendientes, ', ')
    USING ERRCODE = '23514';  -- check_violation
END;
$func$;

-- Crear el trigger (idempotente: drop+create)
DROP TRIGGER IF EXISTS trg_assert_dependencias_firmadas ON ece.documento_instancia;

CREATE TRIGGER trg_assert_dependencias_firmadas
  BEFORE INSERT ON ece.documento_instancia
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_assert_dependencias_firmadas();

COMMENT ON FUNCTION ece.fn_assert_dependencias_firmadas IS
  'Fase 4 enforcement: valida que las dependencias declaradas en tipo_documento.depende_de tengan instancia firmada en el mismo episodio/paciente. Bypass via SET LOCAL app.skip_dependencias_enforcement = true.';

COMMENT ON TRIGGER trg_assert_dependencias_firmadas ON ece.documento_instancia IS
  'Fase 4: defensa en profundidad contra creación de documentos sin dependencias firmadas. Atrapa los 15+ routers ECE que insertan directo (no solo workflow-instance).';

COMMIT;
