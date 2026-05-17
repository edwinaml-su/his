-- =====================================================================
-- 59_ece_04_episodios.sql
-- Episodio de atención ECE — adaptado con FK a public."Encounter" (Opción B).
-- Art. 16, 17 NTEC (Acuerdo n.° 1616, MINSAL 2024).
-- Fase 2 ECE — stream 5/30.
-- Idempotente: usa DO $$ ... IF NOT EXISTS.
-- Aplicar vía mcp__supabase__apply_migration (Supabase SQL Editor).
-- =====================================================================

-- =====================================================================
-- 1. TIPO ENUM DE ESTADOS
--    Valores: abierto · en_curso · cerrado · cancelado
--    "en_curso" exigido por NTEC (Art. 17). "cancelado" = spec Fase 2.
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'ece' AND t.typname = 'estado_episodio'
  ) THEN
    CREATE TYPE ece.estado_episodio AS ENUM (
      'abierto',
      'en_curso',
      'cerrado',
      'cancelado'
    );
    COMMENT ON TYPE ece.estado_episodio IS
      'Ciclo de vida del episodio de atención (Art. 16, 17 NTEC). '
      'Transiciones válidas: abierto→en_curso, en_curso→cerrado|cancelado, abierto→cancelado.';
  END IF;
END $$;

-- =====================================================================
-- 2. EPISODIO DE ATENCIÓN
--    Raíz documental del contacto asistencial (ambulatorio u hospitalario).
--    public_encounter_id — FK nullable a public."Encounter"(id) (Opción B):
--      · Nullable: un episodio ECE puede crearse antes de que el HIS
--        genere el Encounter (ej. registro en papel retroalimentado).
--      · ON DELETE SET NULL: si se borra el Encounter la trazabilidad
--        histórica del episodio ECE no se pierde.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.episodio_atencion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vínculos al dominio ECE
  paciente_id         UUID NOT NULL
                        REFERENCES ece.paciente(id) ON DELETE RESTRICT,
  establecimiento_id  UUID NOT NULL
                        REFERENCES ece.establecimiento(id) ON DELETE RESTRICT,

  -- Vínculo cross-schema al Encounter HIS (Opción B, nullable)
  public_encounter_id UUID
                        REFERENCES public."Encounter"(id) ON DELETE SET NULL,

  -- Clasificación (Art. 17)
  modalidad           TEXT NOT NULL
                        CHECK (modalidad IN ('ambulatorio', 'hospitalario')),
  servicio_categoria  TEXT NOT NULL
                        CHECK (servicio_categoria IN (
                          'consulta_externa', 'emergencia',
                          'hospitalizacion', 'hospital_de_dia')),
  servicio_id         UUID REFERENCES ece.servicio(id) ON DELETE SET NULL,
  origen_consulta     TEXT
                        CHECK (origen_consulta IN (
                          'espontanea', 'cita_previa', 'referencia')),
  modalidad_atencion  TEXT
                        CHECK (modalidad_atencion IN (
                          'presencial', 'telesalud', 'extramural')),
  motivo              TEXT,

  -- Ciclo de vida
  fecha_hora_inicio   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_hora_cierre   TIMESTAMPTZ,
  estado              ece.estado_episodio NOT NULL DEFAULT 'abierto',

  -- Constraint: cierre coherente con estado
  CONSTRAINT chk_cierre_estado CHECK (
    (estado IN ('cerrado', 'cancelado') AND fecha_hora_cierre IS NOT NULL)
    OR estado IN ('abierto', 'en_curso')
  ),

  -- Disposición ambulatoria (Art. 17 lit. a)
  disposicion         TEXT
                        CHECK (disposicion IN (
                          'alta_ambulatoria', 'referencia',
                          'observacion', 'orden_ingreso')),

  -- Auditoría de creación
  creado_por          UUID REFERENCES ece.personal_salud(id) ON DELETE SET NULL,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ece.episodio_atencion IS
  'Contacto asistencial. Tipo de registro: TRANSACCIONAL. '
  'Raíz de los documentos del episodio (Art. 16, 17 NTEC). '
  'public_encounter_id vincula al Encounter HIS (schema public) cuando existe.';

COMMENT ON COLUMN ece.episodio_atencion.public_encounter_id IS
  'FK nullable a public."Encounter"(id). Opción B: enlace bidireccional ECE↔HIS. '
  'NULL cuando el episodio se registra antes de la admisión formal en HIS.';

-- Índices operativos
CREATE INDEX IF NOT EXISTS idx_episodio_paciente
  ON ece.episodio_atencion(paciente_id);

CREATE INDEX IF NOT EXISTS idx_episodio_estado_abierto
  ON ece.episodio_atencion(estado)
  WHERE estado IN ('abierto', 'en_curso');

CREATE INDEX IF NOT EXISTS idx_episodio_encounter
  ON ece.episodio_atencion(public_encounter_id)
  WHERE public_encounter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_episodio_establecimiento
  ON ece.episodio_atencion(establecimiento_id, fecha_hora_inicio DESC);

-- =====================================================================
-- 3. ESPECIALIZACIÓN HOSPITALARIA
--    1-a-1 con episodio_atencion. Solo existe si modalidad='hospitalario'.
--    Incluye servicio_id y cama_id para localización intra-hospitalaria.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.episodio_hospitalario (
  episodio_id               UUID PRIMARY KEY
                              REFERENCES ece.episodio_atencion(id) ON DELETE CASCADE,

  -- Datos de ingreso (catálogos en ece.catalogo_valor)
  circunstancia_ingreso     TEXT NOT NULL,  -- dominio: circunstancia_ingreso
  procedencia_ingreso       TEXT NOT NULL,  -- dominio: procedencia_ingreso
  modalidad_hospitalaria    TEXT NOT NULL,  -- dominio: modalidad_hospitalaria

  -- Servicio y cama de ingreso
  servicio_id               UUID REFERENCES ece.servicio(id) ON DELETE SET NULL,
  cama_id                   UUID REFERENCES ece.cama(id)    ON DELETE SET NULL,

  -- Fechas hospitalarias
  fecha_hora_orden_ingreso  TIMESTAMPTZ NOT NULL,
  fecha_hora_egreso         TIMESTAMPTZ,

  -- Datos de egreso
  tipo_egreso               TEXT,          -- dominio: tipo_egreso
  circunstancia_alta        TEXT           -- dominio: circunstancia_alta
);

COMMENT ON TABLE ece.episodio_hospitalario IS
  'Datos de la especialización hospitalaria del episodio (Art. 17 lit. b). '
  '1-a-1 con episodio_atencion. servicio_id y cama_id identifican localización.';

COMMENT ON COLUMN ece.episodio_hospitalario.circunstancia_ingreso IS
  'Código de ece.catalogo_valor (dominio=circunstancia_ingreso).';
COMMENT ON COLUMN ece.episodio_hospitalario.procedencia_ingreso IS
  'Código de ece.catalogo_valor (dominio=procedencia_ingreso).';
COMMENT ON COLUMN ece.episodio_hospitalario.modalidad_hospitalaria IS
  'Código de ece.catalogo_valor (dominio=modalidad_hospitalaria).';

-- =====================================================================
-- 4. ASIGNACIÓN DE CAMA (histórico de ocupación por episodio)
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.asignacion_cama (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episodio_id   UUID NOT NULL
                  REFERENCES ece.episodio_hospitalario(episodio_id) ON DELETE CASCADE,
  cama_id       UUID NOT NULL
                  REFERENCES ece.cama(id) ON DELETE RESTRICT,
  desde         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hasta         TIMESTAMPTZ,
  motivo_cambio TEXT,
  CONSTRAINT chk_asignacion_rango CHECK (hasta IS NULL OR hasta > desde)
);

COMMENT ON TABLE ece.asignacion_cama IS
  'Histórico de ocupación de cama por episodio hospitalario. '
  'Registro inmutable: INSERT solo, no UPDATE. Las correcciones se anulan con hasta=NOW().';

CREATE INDEX IF NOT EXISTS idx_asigcama_episodio
  ON ece.asignacion_cama(episodio_id);

CREATE INDEX IF NOT EXISTS idx_asigcama_cama_activa
  ON ece.asignacion_cama(cama_id)
  WHERE hasta IS NULL;

-- =====================================================================
-- 5. LOG DE TRANSICIONES DE ESTADO
--    Audit ligero de cambios de estado del episodio.
--    Separado de audit.audit_log para no acoplar schemas; se puede
--    corrobar con la cadena de audit.audit_log a nivel de fila.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.episodio_estado_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episodio_id   UUID NOT NULL
                  REFERENCES ece.episodio_atencion(id) ON DELETE CASCADE,
  estado_previo ece.estado_episodio,
  estado_nuevo  ece.estado_episodio NOT NULL,
  cambiado_por  UUID REFERENCES ece.personal_salud(id) ON DELETE SET NULL,
  cambiado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  motivo        TEXT
);

COMMENT ON TABLE ece.episodio_estado_log IS
  'Registro inmutable de transiciones de estado del episodio. '
  'Transiciones válidas: abierto→en_curso, en_curso→cerrado|cancelado, abierto→cancelado. '
  'Poblar cambiado_por vía SET LOCAL app.current_user_id antes de la transacción.';

CREATE INDEX IF NOT EXISTS idx_estado_log_episodio
  ON ece.episodio_estado_log(episodio_id, cambiado_en DESC);

-- =====================================================================
-- 6. TRIGGERS
-- =====================================================================

-- 6.1 actualizado_en automático en episodio_atencion
CREATE OR REPLACE FUNCTION ece.fn_episodio_actualizado_en()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en := NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_episodio_actualizado_en'
      AND tgrelid = 'ece.episodio_atencion'::REGCLASS
  ) THEN
    CREATE TRIGGER trg_episodio_actualizado_en
      BEFORE UPDATE ON ece.episodio_atencion
      FOR EACH ROW
      EXECUTE FUNCTION ece.fn_episodio_actualizado_en();
  END IF;
END $$;

-- 6.2 Auto-registro de transición de estado en episodio_estado_log
CREATE OR REPLACE FUNCTION ece.fn_episodio_log_estado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_personal_id UUID;
BEGIN
  -- Solo actuar si el estado realmente cambió
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    -- Inferir el actor desde GUC de la sesión (set via withTenantContext)
    BEGIN
      v_personal_id := NULLIF(current_setting('app.current_user_id', true), '')::UUID;
    EXCEPTION WHEN OTHERS THEN
      v_personal_id := NULL;
    END;

    INSERT INTO ece.episodio_estado_log (
      episodio_id,
      estado_previo,
      estado_nuevo,
      cambiado_por,
      cambiado_en
    ) VALUES (
      NEW.id,
      OLD.estado,
      NEW.estado,
      v_personal_id,
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_episodio_log_estado'
      AND tgrelid = 'ece.episodio_atencion'::REGCLASS
  ) THEN
    CREATE TRIGGER trg_episodio_log_estado
      AFTER UPDATE OF estado ON ece.episodio_atencion
      FOR EACH ROW
      EXECUTE FUNCTION ece.fn_episodio_log_estado();
  END IF;
END $$;

-- 6.3 Validación de transición de estado (guard contra saltos ilegales)
CREATE OR REPLACE FUNCTION ece.fn_episodio_valida_transicion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (
      (OLD.estado = 'abierto'  AND NEW.estado IN ('en_curso', 'cancelado'))
      OR (OLD.estado = 'en_curso' AND NEW.estado IN ('cerrado',  'cancelado'))
    ) THEN
      RAISE EXCEPTION
        'Transición de estado inválida: % → %. '
        'Permitidas: abierto→en_curso|cancelado, en_curso→cerrado|cancelado.',
        OLD.estado, NEW.estado;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_episodio_valida_transicion'
      AND tgrelid = 'ece.episodio_atencion'::REGCLASS
  ) THEN
    CREATE TRIGGER trg_episodio_valida_transicion
      BEFORE UPDATE OF estado ON ece.episodio_atencion
      FOR EACH ROW
      EXECUTE FUNCTION ece.fn_episodio_valida_transicion();
  END IF;
END $$;

-- 6.4 Consistencia: episodio_hospitalario solo para modalidad='hospitalario'
CREATE OR REPLACE FUNCTION ece.fn_chk_modalidad_hospitalaria()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_modalidad TEXT;
BEGIN
  SELECT modalidad INTO v_modalidad
  FROM ece.episodio_atencion
  WHERE id = NEW.episodio_id;

  IF v_modalidad <> 'hospitalario' THEN
    RAISE EXCEPTION
      'episodio_hospitalario solo aplica a episodios con modalidad=hospitalario. '
      'El episodio % tiene modalidad=%.',
      NEW.episodio_id, v_modalidad;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_chk_modalidad_hospitalaria'
      AND tgrelid = 'ece.episodio_hospitalario'::REGCLASS
  ) THEN
    CREATE TRIGGER trg_chk_modalidad_hospitalaria
      BEFORE INSERT OR UPDATE ON ece.episodio_hospitalario
      FOR EACH ROW
      EXECUTE FUNCTION ece.fn_chk_modalidad_hospitalaria();
  END IF;
END $$;
