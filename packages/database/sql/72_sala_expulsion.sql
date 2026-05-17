-- ============================================================================
-- 72_sala_expulsion.sql
--
-- Tabla `ece.sala_expulsion` — Atención obstétrica en sala de expulsión.
--
-- Registra el período expulsivo hasta el alumbramiento (Doc 14 NTEC).
-- Vinculada a `ece.episodio_hospitalario` (episodio_id como PK/FK).
-- Una paciente → un registro por evento obstétrico (UNIQUE parcial).
--
-- Campos clave:
--   tipo_parto              — eutocico | distocico | cesarea_emergencia
--   inicio_expulsivo_ts     — inicio del período expulsivo activo
--   nacimiento_ts           — momento exacto del nacimiento (NTEC obligatorio)
--   presentacion_fetal      — cefálica | pélvica | transversa | otra
--   mecanismo_parto         — espontáneo | fórceps | vacuoextractor | espátulas
--   episiotomia             — se realizó episiotomía
--   desgarro_perineal_grado — 0-4 (OMS)
--   alumbramiento_ts        — expulsión de la placenta
--   placenta_completa       — integridad placentaria verificada
--   sangrado_estimado_ml    — sangrado estimado en mL
--   estado_registro         — borrador | firmado (ginecólogo MC)
--
-- RLS: patrón Cat-E (FK episodio → episodio_atencion → establecimiento_id).
-- Idempotente: CREATE TABLE IF NOT EXISTS + DO $$ para índices y policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ENUM tipo_parto (idempotente)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'ece' AND t.typname = 'tipo_parto'
  ) THEN
    CREATE TYPE ece.tipo_parto AS ENUM (
      'eutocico',
      'distocico',
      'cesarea_emergencia'
    );
    COMMENT ON TYPE ece.tipo_parto IS
      'Clasificación del tipo de parto (Doc 14 NTEC).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. TABLA PRINCIPAL
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.sala_expulsion (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FK a episodio hospitalario obstétrico.
    -- episodio_hospitalario usa episodio_id como PK (FK → episodio_atencion).
    episodio_hospitalario_id UUID        NOT NULL
                                 REFERENCES ece.episodio_hospitalario(episodio_id)
                                 ON DELETE RESTRICT,

    -- Tipo de parto
    tipo_parto               ece.tipo_parto NOT NULL,

    -- Cronología del evento expulsivo
    inicio_expulsivo_ts      TIMESTAMPTZ,
    nacimiento_ts            TIMESTAMPTZ NOT NULL,

    -- Presentación y mecanismo
    presentacion_fetal       TEXT        NOT NULL
                                 CHECK (presentacion_fetal IN (
                                     'cefalica', 'pelvica', 'transversa', 'otra'
                                 )),
    mecanismo_parto          TEXT        NOT NULL
                                 CHECK (mecanismo_parto IN (
                                     'espontaneo', 'forceps', 'vacuoextractor', 'espatulas'
                                 )),

    -- Periné
    episiotomia              BOOLEAN     NOT NULL DEFAULT false,
    desgarro_perineal_grado  SMALLINT    CHECK (desgarro_perineal_grado BETWEEN 0 AND 4),

    -- Alumbramiento
    alumbramiento_ts         TIMESTAMPTZ,
    placenta_completa        BOOLEAN,
    sangrado_estimado_ml     INTEGER     CHECK (sangrado_estimado_ml >= 0),

    -- Placeholder RN (se completa en registrarNacimiento)
    atencion_rn_placeholder  UUID,       -- FK a public."Encounter" RN (nullable hasta registro)

    -- Trazabilidad
    registrado_por           UUID        NOT NULL
                                 REFERENCES ece.personal_salud(id),
    estado_registro          TEXT        NOT NULL DEFAULT 'borrador'
                                 CHECK (estado_registro IN ('borrador', 'firmado')),
    firmado_por              UUID        REFERENCES ece.personal_salud(id),
    firmado_en               TIMESTAMPTZ,
    registrado_en            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MVP: un único registro por episodio obstétrico (sin anulación en esta versión).
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_sala_expulsion_episodio') THEN
        CREATE UNIQUE INDEX uq_sala_expulsion_episodio
            ON ece.sala_expulsion (episodio_hospitalario_id);
    END IF;
END $$;

-- Índices operativos
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sala_exp_episodio') THEN
        CREATE INDEX idx_sala_exp_episodio
            ON ece.sala_expulsion (episodio_hospitalario_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sala_exp_nacimiento') THEN
        CREATE INDEX idx_sala_exp_nacimiento
            ON ece.sala_expulsion (nacimiento_ts DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sala_exp_estado') THEN
        CREATE INDEX idx_sala_exp_estado
            ON ece.sala_expulsion (estado_registro);
    END IF;
END $$;

COMMENT ON TABLE ece.sala_expulsion IS
    'NTEC Doc 14. Registro del período expulsivo y alumbramiento. '
    'One-per-episodio-obstétrico. Firma exclusiva del médico ginecólogo (MC). '
    'nacimiento_ts alimenta al módulo Recién Nacido (newborn).';

-- ---------------------------------------------------------------------------
-- 3. TIPO DE DOCUMENTO SALA_EXPULSION (idempotente)
-- ---------------------------------------------------------------------------

INSERT INTO ece.tipo_documento
    (codigo, nombre, tabla_datos, tipo_registro, modalidad, depende_de, inmutable)
VALUES
    ('SALA_EXPULSION', 'Sala de Expulsión',
     'sala_expulsion', 'maestro', 'hospitalario',
     ARRAY['FICHA_ID'], false)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. RLS — patrón Cat-E (FK episodio → episodio_atencion → establecimiento)
--
-- Chain:
--   sala_expulsion.episodio_hospitalario_id
--     → ece.episodio_hospitalario.episodio_id
--       → ece.episodio_atencion.establecimiento_id
-- ---------------------------------------------------------------------------

ALTER TABLE ece.sala_expulsion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sala_exp_by_estab ON ece.sala_expulsion;
CREATE POLICY sala_exp_by_estab
    ON ece.sala_expulsion
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1
          FROM ece.episodio_hospitalario eh
          JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_id
         WHERE eh.episodio_id = ece.sala_expulsion.episodio_hospitalario_id
           AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
    ));

COMMENT ON POLICY sala_exp_by_estab ON ece.sala_expulsion IS
    'RLS Cat-E: aísla por establecimiento del episodio de atención. '
    'Compatible con withEceContext / applyWorkflowContext.';
