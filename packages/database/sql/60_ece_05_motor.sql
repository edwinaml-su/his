-- =====================================================================
-- 60_ece_05_motor.sql
-- MOTOR DE WORKFLOW DATA-DRIVEN — ECE Avante
--
-- El flujo de cada documento (estados, transiciones, roles que llenan /
-- son responsables / autorizan / firman) se define como DATOS, no como
-- esquema. Cambiar un workflow = modificar filas, no migrar tablas.
--
-- Norma de referencia: Acuerdo n.° 1616 (MINSAL, 2024), Arts. 23, 42,
-- 44, 45, 52, 55 NTEC.
--
-- Idempotente: todos los DDL usan IF NOT EXISTS o DO $$ guards.
-- Aplicar vía mcp__supabase__apply_migration.
--
-- Precondiciones (streams anteriores aplicados):
--   55_ece_00_extensions.sql  → schema ece, extensiones
--   56_ece_01_catalogos.sql   → ece.rol, ece.establecimiento, ece.servicio
--   57_ece_02_seguridad.sql   → ece.personal_salud, ece.firma_electronica
--   58_ece_03_paciente.sql    → ece.paciente
--   59_ece_04_episodios.sql   → ece.episodio_atencion
-- =====================================================================

-- =====================================================================
-- 1. TIPO DE DOCUMENTO
--    Catálogo del expediente. Define cada formulario/documento que puede
--    existir en el ECE: su tabla física de datos, su tipo de registro y
--    sus dependencias (grafo de prerrequisitos, Fase 3 §4).
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.tipo_documento (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        text        NOT NULL,
  nombre        text        NOT NULL,
  -- Nombre de la tabla física en el schema ece que almacena las filas
  -- de datos clínicos de este documento (p.ej. 'historia_clinica',
  -- 'nota_evolucion', 'epicrisis_egreso').
  tabla_datos   text        NOT NULL,
  -- Ciclo de vida de los datos:
  --   maestro       → fila única por paciente/período (p.ej. ficha id)
  --   transaccional → crece con cada atención (notas, órdenes)
  --   historico     → inmutable tras cierre; UPDATE/DELETE bloqueados
  tipo_registro text        NOT NULL
                            CHECK (tipo_registro IN ('maestro','transaccional','historico')),
  -- Ámbito asistencial donde aplica el documento
  modalidad     text        NOT NULL
                            CHECK (modalidad IN ('ambulatorio','hospitalario','ambos')),
  -- Documentos que deben existir (y estar en estado final) antes de
  -- permitir crear una instancia de éste (array de códigos tipo_documento).
  depende_de    text[]      DEFAULT '{}',
  -- true = el documento no admite UPDATE una vez firmado; sólo rectificación
  -- (crea nueva instancia con referencia a la anterior — Art. 42 NTEC).
  inmutable     boolean     NOT NULL DEFAULT false,
  activo        boolean     NOT NULL DEFAULT true,
  CONSTRAINT uq_tipo_documento_codigo UNIQUE (codigo)
);

COMMENT ON TABLE  ece.tipo_documento IS
  'Catálogo de documentos del ECE: tipo de registro, modalidad y grafo de dependencias. '
  'Cambiar un workflow requiere modificar filas, no migrar schema.';
COMMENT ON COLUMN ece.tipo_documento.tabla_datos IS
  'Nombre de la tabla física (ece.<tabla_datos>) que almacena los datos clínicos del formulario.';
COMMENT ON COLUMN ece.tipo_documento.depende_de IS
  'Array de códigos de tipo_documento que deben estar en estado final antes de crear esta instancia.';
COMMENT ON COLUMN ece.tipo_documento.inmutable IS
  'Cuando true, la fila de datos asociada no puede modificarse tras firma; requiere rectificación (Art. 42).';

-- =====================================================================
-- 2. FLUJO DE ESTADOS
--    Un tipo de documento tiene su propio grafo de estados. El orden
--    es referencial (para UI); la navegación real la dictan las
--    transiciones.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.flujo_estado (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_documento_id uuid    NOT NULL REFERENCES ece.tipo_documento(id) ON DELETE RESTRICT,
  codigo            text    NOT NULL,   -- p.ej. 'borrador','en_revision','firmado','validado','certificado','anulado'
  nombre            text    NOT NULL,
  -- Solo un estado inicial y un estado final por tipo_documento están
  -- permitidos (enforced por partial unique index abajo).
  es_inicial        boolean NOT NULL DEFAULT false,
  es_final          boolean NOT NULL DEFAULT false,
  -- Orden de presentación en UI (no determina navegación).
  orden             int     NOT NULL DEFAULT 0,
  CONSTRAINT uq_flujo_estado_codigo UNIQUE (tipo_documento_id, codigo)
);

COMMENT ON TABLE ece.flujo_estado IS
  'Estados del workflow por tipo de documento. es_inicial/es_final delimitan el ciclo de vida.';

-- Un solo estado inicial por tipo_documento
CREATE UNIQUE INDEX IF NOT EXISTS uix_flujo_estado_inicial
  ON ece.flujo_estado (tipo_documento_id)
  WHERE es_inicial = true;

-- Un solo estado final por tipo_documento
-- (si se necesitan múltiples finales se elimina este índice y se maneja en lógica)
CREATE UNIQUE INDEX IF NOT EXISTS uix_flujo_estado_final
  ON ece.flujo_estado (tipo_documento_id)
  WHERE es_final = true;

-- =====================================================================
-- 3. TRANSICIONES PERMITIDAS
--    Define el grafo dirigido: estado_origen → estado_destino via
--    accion. El rol que autoriza la transición y si exige firma
--    electrónica se registran aquí, no en código de aplicación.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.flujo_transicion (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_documento_id uuid    NOT NULL REFERENCES ece.tipo_documento(id) ON DELETE RESTRICT,
  estado_origen_id  uuid    NOT NULL REFERENCES ece.flujo_estado(id)   ON DELETE RESTRICT,
  estado_destino_id uuid    NOT NULL REFERENCES ece.flujo_estado(id)   ON DELETE RESTRICT,
  -- Nombre de la acción que dispara la transición.
  -- Ejemplos: 'enviar_revision', 'firmar', 'validar', 'certificar', 'anular'.
  accion            text    NOT NULL,
  -- Rol que tiene autoridad para ejecutar esta transición.
  rol_autoriza_id   uuid    NOT NULL REFERENCES ece.rol(id) ON DELETE RESTRICT,
  -- Cuando true, la transición debe adjuntar un firma_electronica_id válido.
  requiere_firma    boolean NOT NULL DEFAULT true,
  -- Una acción dada sobre un estado origen es determinista por tipo_documento.
  CONSTRAINT uq_flujo_transicion_origen_accion
    UNIQUE (tipo_documento_id, estado_origen_id, accion)
);

COMMENT ON TABLE  ece.flujo_transicion IS
  'Grafo de transiciones permitidas. Determina quién puede avanzar el documento y si requiere firma.';
COMMENT ON COLUMN ece.flujo_transicion.accion IS
  'Identificador de la acción: enviar_revision, firmar, validar, certificar, anular, rectificar.';
COMMENT ON COLUMN ece.flujo_transicion.rol_autoriza_id IS
  'Rol que tiene autoridad para ejecutar la transición (Art. 44, 45 NTEC).';

-- Índice de soporte para la consulta "¿qué transiciones puedo ejecutar
-- desde este estado?" (hot path del motor en cada apertura de documento).
CREATE INDEX IF NOT EXISTS idx_flujo_transicion_origen
  ON ece.flujo_transicion (tipo_documento_id, estado_origen_id);

-- =====================================================================
-- 4. ROLES FUNCIONALES POR DOCUMENTO
--    Las cuatro dimensiones: LLENA | RESPONSABLE | AUTORIZA | FIRMA.
--    Se implementan como CHECK (no ENUM Postgres) para evitar el
--    problema de ALTER TYPE ADD VALUE en transacciones (ver CLAUDE.md).
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.documento_rol (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_documento_id uuid    NOT NULL REFERENCES ece.tipo_documento(id) ON DELETE RESTRICT,
  rol_id            uuid    NOT NULL REFERENCES ece.rol(id)            ON DELETE RESTRICT,
  funcion           text    NOT NULL
                            CHECK (funcion IN ('LLENA','RESPONSABLE','AUTORIZA','FIRMA')),
  -- Cuando false, el rol puede participar pero no es requerido para avanzar el workflow.
  obligatorio       boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_documento_rol UNIQUE (tipo_documento_id, rol_id, funcion)
);

COMMENT ON TABLE  ece.documento_rol IS
  'Matriz Fase 2: por documento, qué rol lo llena, es responsable, autoriza o firma.';
COMMENT ON COLUMN ece.documento_rol.funcion IS
  'LLENA=captura datos; RESPONSABLE=titular clínico; AUTORIZA=da visto bueno; FIRMA=firma electrónica.';

-- =====================================================================
-- 5. INSTANCIA DE DOCUMENTO
--    Un documento concreto generado dentro de un episodio. Une el tipo
--    (catálogo), el episodio/paciente y la fila de datos clínicos en
--    la tabla física correspondiente.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.documento_instancia (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_documento_id uuid        NOT NULL REFERENCES ece.tipo_documento(id)   ON DELETE RESTRICT,
  episodio_id       uuid                 REFERENCES ece.episodio_atencion(id) ON DELETE RESTRICT,
  paciente_id       uuid        NOT NULL REFERENCES ece.paciente(id)          ON DELETE RESTRICT,
  -- UUID de la fila en ece.<tipo_documento.tabla_datos> (FK lógica; no se
  -- puede declarar FK referencial porque la tabla objetivo varía por tipo).
  registro_id       uuid,
  estado_actual_id  uuid        NOT NULL REFERENCES ece.flujo_estado(id)     ON DELETE RESTRICT,
  -- Número de versión; incrementa en rectificaciones (Art. 42 NTEC).
  version           int         NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- vigente = activo; rectificado = reemplazado por versión superior;
  -- suprimido = anulado con causa documentada.
  estado_registro   text        NOT NULL DEFAULT 'vigente'
                                CHECK (estado_registro IN ('vigente','rectificado','suprimido')),
  creado_por        uuid        NOT NULL REFERENCES ece.personal_salud(id)   ON DELETE RESTRICT,
  creado_en         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  ece.documento_instancia IS
  'Documento real del expediente. Une tipo, episodio y fila de datos clínicos.';
COMMENT ON COLUMN ece.documento_instancia.registro_id IS
  'UUID de la fila en ece.<tipo_documento.tabla_datos>. FK lógica (tabla objetivo varía por tipo).';
COMMENT ON COLUMN ece.documento_instancia.version IS
  'Versión del documento. La rectificación crea nueva instancia con version+1 (Art. 42 NTEC).';

CREATE INDEX IF NOT EXISTS idx_docinst_episodio
  ON ece.documento_instancia (episodio_id);
CREATE INDEX IF NOT EXISTS idx_docinst_paciente
  ON ece.documento_instancia (paciente_id);
CREATE INDEX IF NOT EXISTS idx_docinst_tipo
  ON ece.documento_instancia (tipo_documento_id);
-- Consulta habitual: documentos vigentes de un paciente ordenados por fecha
CREATE INDEX IF NOT EXISTS idx_docinst_paciente_vigente
  ON ece.documento_instancia (paciente_id, creado_en DESC)
  WHERE estado_registro = 'vigente';

-- =====================================================================
-- 6. HISTORIAL DE TRANSICIONES (BITÁCORA INMUTABLE)
--    Registra quién, cuándo y con qué firma ejecutó cada cambio de
--    estado. Solo INSERT. Protegido por trigger BEFORE UPDATE/DELETE.
--    Arts. 42, 55 NTEC.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.documento_instancia_historial (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instancia_id        uuid        NOT NULL REFERENCES ece.documento_instancia(id) ON DELETE RESTRICT,
  estado_anterior_id  uuid                 REFERENCES ece.flujo_estado(id)        ON DELETE RESTRICT,
  estado_nuevo_id     uuid        NOT NULL REFERENCES ece.flujo_estado(id)        ON DELETE RESTRICT,
  accion              text        NOT NULL,
  ejecutado_por       uuid        NOT NULL REFERENCES ece.personal_salud(id)      ON DELETE RESTRICT,
  rol_ejecutor_id     uuid        NOT NULL REFERENCES ece.rol(id)                 ON DELETE RESTRICT,
  -- Firma electrónica adjunta cuando la transición requiere_firma = true.
  firma_id            uuid                 REFERENCES ece.firma_electronica(id)   ON DELETE RESTRICT,
  observacion         text,
  -- clock_timestamp() da la marca temporal real de ejecución (no la de
  -- la transacción), cumpliendo el nivel segundo exigido por Art. 55 NTEC.
  ejecutado_en        timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE  ece.documento_instancia_historial IS
  'Bitácora de workflow. Solo INSERT permitido. Marca temporal a nivel segundo (Art. 55 NTEC).';
COMMENT ON COLUMN ece.documento_instancia_historial.ejecutado_en IS
  'clock_timestamp(): marca temporal real de ejecución, nivel segundo (Art. 55 NTEC).';
COMMENT ON COLUMN ece.documento_instancia_historial.firma_id IS
  'Referencia a ece.firma_electronica. Obligatoria cuando flujo_transicion.requiere_firma = true.';

CREATE INDEX IF NOT EXISTS idx_dih_instancia
  ON ece.documento_instancia_historial (instancia_id);
CREATE INDEX IF NOT EXISTS idx_dih_ejecutado_en
  ON ece.documento_instancia_historial (ejecutado_en DESC);

-- =====================================================================
-- 7. TRIGGERS
-- =====================================================================

-- ---------------------------------------------------------------------
-- 7a. Bitácora inmutable: bloquea UPDATE y DELETE en historial
--     Invariante: la bitácora de workflow es append-only.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ece.fn_historial_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'ece.documento_instancia_historial es inmutable: UPDATE y DELETE no permitidos. '
    'instancia_id=%, id=%',
    OLD.instancia_id, OLD.id
    USING ERRCODE = 'prohibited_sql_statement_attempted'; -- 2F003
END;
$$;

COMMENT ON FUNCTION ece.fn_historial_inmutable() IS
  'Hace inmutable la bitácora de transiciones. Lanza excepción ante UPDATE/DELETE (Art. 42/55 NTEC).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_historial_inmutable'
      AND tgrelid = 'ece.documento_instancia_historial'::regclass
  ) THEN
    CREATE TRIGGER trg_historial_inmutable
      BEFORE UPDATE OR DELETE
      ON ece.documento_instancia_historial
      FOR EACH ROW
      EXECUTE FUNCTION ece.fn_historial_inmutable();
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 7b. Tablas de datos "historico": bloquea UPDATE/DELETE en la tabla
--     de datos clínicos cuando el tipo_documento tiene
--     tipo_registro = 'historico'.
--
--     Mecanismo: trigger genérico que recibe el nombre de la tabla de
--     datos como parámetro (tgargs). Los archivos de documentos
--     clínicos (60+ streams) registran este trigger en su propia tabla
--     de datos usando la helper function ece.registrar_tabla_historica().
--
--     Invariante: una fila de datos histórica solo puede crearse;
--     modificarla requiere rectificación (nueva instancia, version+1).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ece.fn_tabla_historica_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tabla_datos text := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
  v_tipo_registro text;
BEGIN
  -- Verificar que el tipo_documento asociado es efectivamente 'historico'.
  SELECT td.tipo_registro INTO v_tipo_registro
    FROM ece.tipo_documento td
   WHERE td.tabla_datos = TG_TABLE_NAME
     AND td.tipo_registro = 'historico'
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'La tabla % corresponde a un tipo de documento histórico: '
      'UPDATE y DELETE no permitidos. Use rectificación (nueva instancia con version+1).',
      v_tabla_datos
      USING ERRCODE = 'prohibited_sql_statement_attempted'; -- 2F003
  END IF;

  -- Si la tabla no está registrada como histórica en tipo_documento,
  -- la operación se permite (no bloquear otras tablas que compartan trigger).
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION ece.fn_tabla_historica_inmutable() IS
  'Bloquea UPDATE/DELETE en tablas de datos cuyo tipo_documento.tipo_registro = ''historico''. '
  'Se registra desde ece.registrar_tabla_historica() en cada tabla de datos clínicos.';

-- Helper para que los streams de documentos clínicos registren el trigger
-- de inmutabilidad en su propia tabla sin duplicar DDL.
-- Uso: SELECT ece.registrar_tabla_historica('nombre_tabla');
CREATE OR REPLACE FUNCTION ece.registrar_tabla_historica(p_tabla text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_trigger_name text := 'trg_historico_inmutable_' || p_tabla;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE t.tgname = v_trigger_name
       AND n.nspname = 'ece'
       AND c.relname = p_tabla
  ) THEN
    EXECUTE format(
      'CREATE TRIGGER %I
         BEFORE UPDATE OR DELETE
         ON ece.%I
         FOR EACH ROW
         EXECUTE FUNCTION ece.fn_tabla_historica_inmutable()',
      v_trigger_name, p_tabla
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION ece.registrar_tabla_historica(text) IS
  'Registra el trigger de inmutabilidad histórica en una tabla de datos clínicos. '
  'Llamar desde el stream SQL que crea la tabla cuando tipo_registro = ''historico''.';

-- =====================================================================
-- FIN 60_ece_05_motor.sql
-- =====================================================================
