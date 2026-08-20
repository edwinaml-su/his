-- =============================================================================
-- 203_ece_dir_certificar_corregido.sql
--
-- Reescribe ece.fn_check_dir_certificar (62_ece_07_rls.sql §7) — control NTEC
-- Art. 45: solo el rol DIR puede llevar un documento a estado 'certificado'.
--
-- ─── Por qué una reescritura y no un apply del 62 ───────────────────────────
--
-- Verificado por introspección de prod (2026-08-20): ni la función ni el
-- trigger existen. Nunca se aplicaron. Y no podían: la versión de 62 tiene
-- TRES referencias a columnas que no existen en el schema real.
--
--   1. Dispara con `BEFORE UPDATE OF estado_registro` y compara
--      `NEW.estado_registro = 'certificado'`.
--      Pero el estado de workflow de ece.documento_instancia vive en
--      `estado_actual_id` (uuid → ece.flujo_estado), NO en `estado_registro`
--      (que es un marcador de ciclo de vida distinto). TODOS los caminos que
--      transicionan — workflow/transitions.ts:189, rri.router.ts:323,
--      preop-checklist.router.ts:567, evolucion-medica.router.ts:133 —
--      escriben `estado_actual_id`. El trigger nunca habría disparado.
--
--      (La nota @DBA de feat/db-portable en 62 corrigió `estado` →
--      `estado_registro`, que era cierto como nombre de columna pero seguía
--      siendo la columna equivocada para este control.)
--
--   2. `ar.rol_codigo` no existe en ece.asignacion_rol — la columna es
--      `rol_id` (uuid → ece.rol, donde vive `codigo`).
--
--   3. `ar.vigente` no existe — la vigencia se modela con `activo` +
--      `vigente_desde` / `vigente_hasta`.
--
--   O sea que aun forzando el disparo, habría reventado en runtime con
--   `column ar.rol_codigo does not exist`. Aplicar el 62 tal cual habría
--   instalado un control inerte y dejado la matriz de cumplimiento diciendo
--   que Art. 45 está enforced a nivel BD. Mismo patrón que 142/146.
--
-- ─── Alcance real de este control ───────────────────────────────────────────
--
-- Es defensa en profundidad, no la única barrera: `ejecutarTransicion`
-- (packages/trpc/src/workflow/transitions.ts) ya valida el rol contra
-- `ece.flujo_transicion.rol_autoriza_id` vía `canTransition()` antes del
-- UPDATE. Este trigger cubre el caso de escritura directa a la tabla
-- (seeders, scripts, un router que se salte el helper).
--
-- 'certificado' existe como código de estado en 3 tipos de documento, los 3
-- con es_final=true. ece.documento_instancia está vacía en prod (0 filas), así
-- que no hay riesgo de bloquear datos existentes.
--
-- ─── Postura fail-safe ──────────────────────────────────────────────────────
--
-- Sin contexto ECE (`ece.current_personal_id()` NULL) el trigger DENIEGA. El
-- único camino de escritura legítimo (`withWorkflowContext`) siempre setea los
-- GUC; un actor sin contexto no debe poder certificar.
-- `ece.bitacora_acceso.establecimiento_id` es nullable, así que el registro en
-- bitácora no falla cuando no hay establecimiento en contexto.
--
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION ece.fn_check_dir_certificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ece, public, pg_catalog
AS $fn$
DECLARE
  v_codigo_nuevo text;
  v_codigo_viejo text;
  v_personal     uuid;
BEGIN
  SELECT codigo INTO v_codigo_nuevo FROM ece.flujo_estado WHERE id = NEW.estado_actual_id;

  IF v_codigo_nuevo IS DISTINCT FROM 'certificado' THEN
    RETURN NEW;
  END IF;

  SELECT codigo INTO v_codigo_viejo FROM ece.flujo_estado WHERE id = OLD.estado_actual_id;

  -- Solo en la transición HACIA 'certificado'. Si ya estaba certificado, esto
  -- es una re-escritura del mismo estado y no hay nada que autorizar.
  IF v_codigo_viejo IS NOT DISTINCT FROM 'certificado' THEN
    RETURN NEW;
  END IF;

  v_personal := ece.current_personal_id();

  IF v_personal IS NULL OR NOT EXISTS (
    SELECT 1
      FROM ece.asignacion_rol ar
      JOIN ece.rol r ON r.id = ar.rol_id
     WHERE ar.personal_id = v_personal
       AND r.codigo       = 'DIR'
       AND ar.activo
       AND ar.vigente_desde <= now()
       AND (ar.vigente_hasta IS NULL OR ar.vigente_hasta > now())
  ) THEN
    RAISE EXCEPTION
      'Acceso denegado: solo el rol DIR puede certificar documentos (Art. 45 NTEC).'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO ece.bitacora_acceso(
    personal_id, recurso_id, accion, autorizado,
    ocurrido_en, justificacion, establecimiento_id
  ) VALUES (
    v_personal,
    NEW.id,
    'certificar',
    true,
    clock_timestamp(),
    'Transición a estado certificado autorizada por DIR',
    ece.current_establecimiento_id()
  );

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION ece.fn_check_dir_certificar() IS
  'NTEC Art. 45 (SQL 203): rechaza la transición de estado_actual_id hacia el estado codigo=certificado si el personal en contexto ECE no tiene rol DIR vigente. Registra el evento en ece.bitacora_acceso. Defensa en profundidad sobre canTransition() de workflow/transitions.ts.';

DROP TRIGGER IF EXISTS trg_dir_certificar ON ece.documento_instancia;
CREATE TRIGGER trg_dir_certificar
  BEFORE UPDATE OF estado_actual_id ON ece.documento_instancia
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_check_dir_certificar();

-- ─── Verificación post-apply ─────────────────────────────────────────────────
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--  WHERE tgrelid = 'ece.documento_instancia'::regclass AND NOT tgisinternal;
-- Esperado: trg_dir_certificar BEFORE UPDATE OF estado_actual_id.
