-- =====================================================================
-- 62_ece_07_rls.sql
-- ECE — Auditoría, seguridad, inmutabilidad y RLS (Opción B: GUC).
-- Insumo base: docs/backlog/fase2/_insumos/07_auditoria_seguridad.sql
-- Arts. 33, 42, 43, 53, 54, 55, 56 NTEC (Acuerdo 1616, MINSAL 2024).
--
-- Patrón de contexto: análogo a public.set_tenant_context() en
-- 04_rls_session_helpers.sql, pero sobre GUCs app.ece_personal_id /
-- app.ece_establecimiento_id, scope ECE.
--
-- Idempotente: CREATE OR REPLACE / DROP POLICY IF EXISTS / IF NOT EXISTS.
-- Aplicar vía mcp__supabase__apply_migration dentro de una transacción.
-- =====================================================================

-- -----------------------------------------------------------------------
-- SECCIÓN 1: Helper de contexto ECE
-- Análogo a public.set_tenant_context(). Debe llamarse desde tRPC dentro
-- de una transacción (SET LOCAL aplica solo al bloque transaccional).
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.set_ece_context(
  p_personal_id        uuid,
  p_establecimiento_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER   -- necesario para que el rol 'authenticated' pueda setear GUCs
AS $$
BEGIN
  PERFORM set_config('app.ece_personal_id',
    coalesce(p_personal_id::text, ''), true);
  PERFORM set_config('app.ece_establecimiento_id',
    coalesce(p_establecimiento_id::text, ''), true);
END;
$$;

COMMENT ON FUNCTION ece.set_ece_context(uuid, uuid) IS
  'Opción-B GUC: setea contexto ECE en la transacción actual. '
  'Invocar vía withTenantContext equivalente antes de queries RLS. '
  'SET LOCAL → solo dura la transacción; no-op fuera de tx.';

-- Helpers de lectura de GUC (STABLE → cacheables por statement)
CREATE OR REPLACE FUNCTION ece.current_personal_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    current_setting('app.ece_personal_id', true), ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION ece.current_establecimiento_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    current_setting('app.ece_establecimiento_id', true), ''
  )::uuid;
$$;

-- -----------------------------------------------------------------------
-- SECCIÓN 2: Bitácora de acceso (Art. 55)
-- Registra TODO intento (autorizado o denegado). Append-only.
-- Retención: 2 años (Art. 56).
-- Columnas spec: usuario(personal_id), recurso(recurso_id), accion,
-- autorizado, ip(ip_origen), ts-segundo(ocurrido_en), justificacion.
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.bitacora_acceso (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  personal_id      uuid REFERENCES ece.personal_salud(id),   -- usuario
  recurso_id       uuid,                                       -- doc / paciente afectado
  accion           text NOT NULL,     -- lectura|escritura|login|export|certificar
  autorizado       boolean NOT NULL,
  ip_origen        inet,
  ocurrido_en      timestamptz NOT NULL DEFAULT clock_timestamp(), -- precisión segundo
  justificacion    text,              -- requerida cuando autorizado=false o accion=certificar
  -- contexto de sesión
  auth_user_id     uuid,              -- auth.uid() en momento del evento
  establecimiento_id uuid REFERENCES ece.establecimiento(id)
);

-- Índice operativo principal: auditoría por personal + tiempo
CREATE INDEX IF NOT EXISTS idx_biacc_personal_ts
  ON ece.bitacora_acceso(personal_id, ocurrido_en DESC);

-- Índice para consultas de retención / purga (solo listar > 2 años)
CREATE INDEX IF NOT EXISTS idx_biacc_ts_brin
  ON ece.bitacora_acceso USING BRIN(ocurrido_en);

-- Índice por establecimiento (consultas de auditoría por sede)
CREATE INDEX IF NOT EXISTS idx_biacc_estab
  ON ece.bitacora_acceso(establecimiento_id, ocurrido_en DESC);

COMMENT ON TABLE ece.bitacora_acceso IS
  'Art. 55/56 NTEC. Retención mínima 2 años. '
  'Solo INSERT; nunca alterar ni desactivar (Art. 53). Append-only.';
COMMENT ON COLUMN ece.bitacora_acceso.justificacion IS
  'Obligatoria cuando autorizado=false o accion=''certificar''.';
COMMENT ON COLUMN ece.bitacora_acceso.ocurrido_en IS
  'Marca temporal a nivel segundo (Art. 55 lit. a). clock_timestamp() no NOW() '
  'para evitar colapso en transacciones largas.';

-- -----------------------------------------------------------------------
-- SECCIÓN 3: Rectificación (Art. 42)
-- NO borra el registro original; agrega un registro de corrección con
-- hash del original para trazabilidad criptográfica.
-- Columnas spec: documento_original_id, motivo, usuario, ts, hash_original.
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.rectificacion (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_original_id uuid NOT NULL,   -- PK de la fila rectificada (cualquier tabla)
  tabla_origen         text NOT NULL,    -- nombre de la tabla origen (e.g. 'historia_clinica')
  motivo               text NOT NULL,    -- obligatorio por Art. 42
  usuario_id           uuid NOT NULL REFERENCES ece.personal_salud(id),
  creado_en            timestamptz NOT NULL DEFAULT clock_timestamp(),
  hash_original        text NOT NULL,    -- SHA-256 hex del payload JSON antes de rectificar
  -- campos opcionales de detalle
  campo                text,             -- columna específica modificada (si aplica)
  valor_anterior       text,
  valor_nuevo          text,
  establecimiento_id   uuid REFERENCES ece.establecimiento(id)
);

CREATE INDEX IF NOT EXISTS idx_rect_doc_orig
  ON ece.rectificacion(documento_original_id);

CREATE INDEX IF NOT EXISTS idx_rect_usuario_ts
  ON ece.rectificacion(usuario_id, creado_en DESC);

COMMENT ON TABLE ece.rectificacion IS
  'Art. 42 NTEC. Corrige datos inexactos SIN borrar el original. '
  'hash_original = SHA-256 del payload JSON previo a la corrección.';
COMMENT ON COLUMN ece.rectificacion.hash_original IS
  'SHA-256 hex del registro antes de rectificar. '
  'Calcular desde aplicación: encode(digest(row_json, ''sha256''), ''hex'').';

-- -----------------------------------------------------------------------
-- SECCIÓN 4: Función de bloqueo de mutación (Art. 42 — inmutabilidad)
-- Impide UPDATE / DELETE en tablas históricas/legales.
-- Las correcciones deben pasar por ece.rectificacion.
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.fn_bloquea_mutacion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Registro inmutable (Art. 42 NTEC). Use el flujo de rectificación '
    '(tabla ece.rectificacion) para correcciones; no se permiten UPDATE/DELETE.';
END;
$$;

COMMENT ON FUNCTION ece.fn_bloquea_mutacion() IS
  'Trigger BEFORE UPDATE OR DELETE. Aplica a todas las tablas con '
  'tipo_registro=historico según Art. 42 NTEC.';

-- -----------------------------------------------------------------------
-- SECCIÓN 5: Aplicar inmutabilidad a tablas históricas/legales
-- Lista explícita de tablas definidas en insumo 07 + documentos clínicos
-- que son inmutables por NTEC.
-- Idempotente: DROP TRIGGER IF EXISTS antes de crear.
-- -----------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    -- bitácoras propias (no se modifican por definición)
    'bitacora_acceso',
    'bitacora_auditoria',
    -- documentos de cierre / legales
    'consentimiento_informado',
    'epicrisis_egreso',
    'certificado_defuncion',
    'acto_quirurgico',
    -- rectificación y supresión son append-only también
    'rectificacion',
    'supresion',
    -- historial de estados de instancias
    'documento_instancia_historial'
  ]
  LOOP
    -- Solo actuar si la tabla existe en el schema ece
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'ece' AND table_name = tbl
    ) THEN
      -- Idempotencia: eliminar trigger anterior si existe
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_inmutable_%1$s ON ece.%1$s', tbl
      );
      EXECUTE format(
        'CREATE TRIGGER trg_inmutable_%1$s
         BEFORE UPDATE OR DELETE ON ece.%1$s
         FOR EACH ROW EXECUTE FUNCTION ece.fn_bloquea_mutacion()', tbl
      );
    END IF;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------
-- SECCIÓN 6: Row Level Security — aislamiento por establecimiento_id
-- Patrón Opción B: GUC app.ece_establecimiento_id seteado por
-- ece.set_ece_context() dentro de transacción tRPC.
--
-- Tablas cubiertas por este archivo (las demás en 63_ece_*):
--   ece.bitacora_acceso   — solo propio establecimiento puede leer su log
--   ece.rectificacion     — idem
--
-- Tablas core (paciente, episodio, historia_clinica, documento_instancia)
-- tienen RLS en insumo original 07; aquí reescribimos con patrón GUC B.
-- -----------------------------------------------------------------------

-- Habilitar RLS en tablas de este módulo
ALTER TABLE ece.bitacora_acceso     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.rectificacion       ENABLE ROW LEVEL SECURITY;

-- Si las tablas core ya existen, habilitar también
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'paciente', 'episodio_atencion', 'historia_clinica',
    'evolucion_medica', 'documento_instancia'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'ece' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE ece.%I ENABLE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END;
$$;

-- --- bitacora_acceso -------------------------------------------------

-- SELECT: personal ve solo registros de su establecimiento
DROP POLICY IF EXISTS ece_biacc_select ON ece.bitacora_acceso;
CREATE POLICY ece_biacc_select ON ece.bitacora_acceso
  FOR SELECT
  USING (establecimiento_id = ece.current_establecimiento_id());

-- INSERT: el contexto ECE debe estar seteado y coincidir
DROP POLICY IF EXISTS ece_biacc_insert ON ece.bitacora_acceso;
CREATE POLICY ece_biacc_insert ON ece.bitacora_acceso
  FOR INSERT
  WITH CHECK (
    establecimiento_id = ece.current_establecimiento_id()
    AND ece.current_establecimiento_id() IS NOT NULL
  );

-- No se permiten UPDATE / DELETE (el trigger fn_bloquea_mutacion los rechaza
-- igualmente, pero la policy añade una segunda línea de defensa).
DROP POLICY IF EXISTS ece_biacc_no_update ON ece.bitacora_acceso;
CREATE POLICY ece_biacc_no_update ON ece.bitacora_acceso
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS ece_biacc_no_delete ON ece.bitacora_acceso;
CREATE POLICY ece_biacc_no_delete ON ece.bitacora_acceso
  FOR DELETE USING (false);

-- --- rectificacion ---------------------------------------------------

DROP POLICY IF EXISTS ece_rect_select ON ece.rectificacion;
CREATE POLICY ece_rect_select ON ece.rectificacion
  FOR SELECT
  USING (establecimiento_id = ece.current_establecimiento_id());

DROP POLICY IF EXISTS ece_rect_insert ON ece.rectificacion;
CREATE POLICY ece_rect_insert ON ece.rectificacion
  FOR INSERT
  WITH CHECK (
    establecimiento_id = ece.current_establecimiento_id()
    AND ece.current_establecimiento_id() IS NOT NULL
    AND usuario_id = ece.current_personal_id()
  );

-- Append-only: no update, no delete
DROP POLICY IF EXISTS ece_rect_no_update ON ece.rectificacion;
CREATE POLICY ece_rect_no_update ON ece.rectificacion
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS ece_rect_no_delete ON ece.rectificacion;
CREATE POLICY ece_rect_no_delete ON ece.rectificacion
  FOR DELETE USING (false);

-- --- paciente (reescritura Opción B) ---------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ece' AND table_name = 'paciente'
  ) THEN

    -- SELECT: personal activo del mismo establecimiento
    EXECUTE $p$
      DROP POLICY IF EXISTS ece_paciente_select ON ece.paciente;
      CREATE POLICY ece_paciente_select ON ece.paciente
        FOR SELECT
        USING (
          establecimiento_id = ece.current_establecimiento_id()
          AND EXISTS (
            SELECT 1 FROM ece.personal_salud ps
             WHERE ps.id = ece.current_personal_id()
               AND ps.activo
               AND ps.establecimiento_id = ece.current_establecimiento_id()
          )
        )
    $p$;

    -- INSERT/UPDATE: personal activo con permiso escritura
    EXECUTE $p$
      DROP POLICY IF EXISTS ece_paciente_write ON ece.paciente;
      CREATE POLICY ece_paciente_write ON ece.paciente
        FOR ALL
        USING (establecimiento_id = ece.current_establecimiento_id())
        WITH CHECK (
          establecimiento_id = ece.current_establecimiento_id()
          AND EXISTS (
            SELECT 1
              FROM ece.personal_salud ps
              JOIN ece.asignacion_rol ar ON ar.personal_id = ps.id AND ar.vigente
              JOIN ece.perfil_acceso  pa ON pa.rol_id = ar.rol_id
             WHERE ps.id  = ece.current_personal_id()
               AND ps.activo
               AND pa.recurso = 'paciente'
               AND pa.permiso = 'escritura'
          )
        )
    $p$;

  END IF;
END;
$$;

-- -----------------------------------------------------------------------
-- SECCIÓN 7: Policy especial — transición 'certificar'
-- Solo el rol DIR (Director) puede ejecutar la transición de estado
-- 'certificar' en documento_instancia.
-- Invariante: rol_codigo = 'DIR' en ece.asignacion_rol vigente.
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.fn_check_dir_certificar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Solo aplica cuando el nuevo estado es 'certificado'
  IF NEW.estado = 'certificado' AND (OLD.estado IS DISTINCT FROM 'certificado') THEN
    -- Verificar que el personal en contexto tenga rol DIR vigente
    IF NOT EXISTS (
      SELECT 1
        FROM ece.asignacion_rol ar
       WHERE ar.personal_id = ece.current_personal_id()
         AND ar.rol_codigo   = 'DIR'
         AND ar.vigente
    ) THEN
      RAISE EXCEPTION
        'Acceso denegado: solo el rol DIR puede certificar documentos (Art. 45 NTEC).';
    END IF;

    -- Registrar intento en bitácora (Art. 55)
    INSERT INTO ece.bitacora_acceso(
      personal_id, recurso_id, accion, autorizado,
      ocurrido_en, justificacion, establecimiento_id
    ) VALUES (
      ece.current_personal_id(),
      NEW.id,
      'certificar',
      true,
      clock_timestamp(),
      'Transición a estado certificado autorizada por DIR',
      ece.current_establecimiento_id()
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ece.fn_check_dir_certificar() IS
  'Trigger BEFORE UPDATE en documento_instancia. '
  'Rechaza la transición a estado=''certificado'' si el contexto ECE '
  'no tiene rol DIR vigente. Registra el evento en bitacora_acceso.';

-- Aplicar trigger solo si la tabla existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'ece' AND table_name = 'documento_instancia'
  ) THEN
    DROP TRIGGER IF EXISTS trg_dir_certificar ON ece.documento_instancia;
    CREATE TRIGGER trg_dir_certificar
      BEFORE UPDATE OF estado ON ece.documento_instancia
      FOR EACH ROW
      EXECUTE FUNCTION ece.fn_check_dir_certificar();
  END IF;
END;
$$;

-- -----------------------------------------------------------------------
-- SECCIÓN 8: Comentarios finales de integridad
-- -----------------------------------------------------------------------

COMMENT ON FUNCTION ece.set_ece_context(uuid, uuid) IS
  'Opción-B GUC para tRPC. Equivalente a public.set_tenant_context() '
  'del módulo principal HIS, pero scope ECE (personal + establecimiento). '
  'SET LOCAL → requiere transacción activa. Fuera de tx es no-op silencioso.';

COMMENT ON FUNCTION ece.fn_bloquea_mutacion() IS
  'Rechaza UPDATE/DELETE en tablas históricas/legales ECE (Art. 42 NTEC). '
  'Segunda línea de defensa junto con policies FOR UPDATE/DELETE USING(false).';

COMMENT ON FUNCTION ece.fn_check_dir_certificar() IS
  'Invariante: solo rol DIR transiciona estado→certificado. '
  'Registra evento en ece.bitacora_acceso automáticamente.';
