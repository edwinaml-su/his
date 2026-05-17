-- ============================================================================
-- 69_registro_anestesico.sql
--
-- Tabla `ece.registro_anestesico` — registro anestésico intraoperatorio.
--
-- FK: acto_quirurgico_id → ece.acto_quirurgico(id)
-- RLS: patrón Cat E (FK acto→episodio→atencion→establecimiento).
-- Tipo documento: REG_ANEST (idempotente en ece.tipo_documento).
-- Idempotente: CREATE TABLE IF NOT EXISTS + DO $$ para índices y policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLA PRINCIPAL
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.registro_anestesico (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FK al acto quirúrgico (one-per-acto: constraint parcial más abajo).
    acto_quirurgico_id          UUID        NOT NULL
                                    REFERENCES ece.acto_quirurgico(id)
                                    ON DELETE RESTRICT,

    -- Vincula con el motor de workflow.
    instancia_id                UUID
                                    REFERENCES ece.documento_instancia(id)
                                    ON DELETE SET NULL,

    -- Clasificación ASA (1–5).
    asa                         SMALLINT    NOT NULL
                                    CHECK (asa BETWEEN 1 AND 5),

    -- Tipo de anestesia administrada.
    tipo_anestesia              TEXT        NOT NULL
                                    CHECK (tipo_anestesia IN (
                                        'general', 'regional', 'local', 'sedacion'
                                    )),

    -- Manejo de vía aérea.
    via_aerea                   TEXT        NOT NULL
                                    CHECK (via_aerea IN (
                                        'intubacion', 'mascarilla', 'lma'
                                    )),

    -- Medicamentos administrados durante el acto.
    -- Estructura esperada: [{ nombre, dosis, via, hora_administracion }]
    medicamentos_administrados  JSONB       NOT NULL DEFAULT '[]'::jsonb,

    -- Serie temporal de signos vitales intraoperatorios cada ~5 min.
    -- Estructura esperada: [{ ts, ta_sistolica, ta_diastolica, fc, fr, spo2, etco2 }]
    signos_vitales_intraop      JSONB       NOT NULL DEFAULT '[]'::jsonb,

    -- Incidencias y eventos adversos registrados.
    complicaciones              TEXT,

    -- Balance hídrico.
    fluidoterapia_ml            INTEGER     CHECK (fluidoterapia_ml >= 0),
    perdidas_sanguineas_ml      INTEGER     CHECK (perdidas_sanguineas_ml >= 0),

    -- Trazabilidad — firmado por anestesiólogo (rol ESP).
    registrado_por              UUID        NOT NULL
                                    REFERENCES ece.personal_salud(id),
    estado_registro             TEXT        NOT NULL DEFAULT 'borrador'
                                    CHECK (estado_registro IN (
                                        'borrador', 'firmado', 'anulado'
                                    )),
    firmado_por                 UUID        REFERENCES ece.personal_salud(id),
    firmado_en                  TIMESTAMPTZ,
    registrado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un acto quirúrgico tiene como máximo un registro anestésico no anulado.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_registro_anestesico_acto_activo'
    ) THEN
        CREATE UNIQUE INDEX uq_registro_anestesico_acto_activo
            ON ece.registro_anestesico (acto_quirurgico_id)
            WHERE estado_registro <> 'anulado';
    END IF;
END $$;

-- Índices de búsqueda frecuente.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reg_anest_acto') THEN
        CREATE INDEX idx_reg_anest_acto
            ON ece.registro_anestesico (acto_quirurgico_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reg_anest_estado') THEN
        CREATE INDEX idx_reg_anest_estado
            ON ece.registro_anestesico (estado_registro);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reg_anest_instancia') THEN
        CREATE INDEX idx_reg_anest_instancia
            ON ece.registro_anestesico (instancia_id)
            WHERE instancia_id IS NOT NULL;
    END IF;
END $$;

COMMENT ON TABLE ece.registro_anestesico IS
    'Registro anestésico intraoperatorio. '
    'Incluye ASA, tipo de anestesia, vía aérea, medicamentos (JSONB), '
    'serie temporal de signos vitales (JSONB), complicaciones y balance hídrico. '
    'Firmado por anestesiólogo (rol ESP). RLS Cat-E.';

-- ---------------------------------------------------------------------------
-- 2. TIPO DE DOCUMENTO REG_ANEST (idempotente)
-- ---------------------------------------------------------------------------

INSERT INTO ece.tipo_documento
    (codigo, nombre, tabla_datos, tipo_registro, modalidad, depende_de, inmutable)
VALUES
    ('REG_ANEST', 'Registro Anestésico Intraoperatorio',
     'registro_anestesico', 'maestro', 'hospitalario',
     ARRAY['ACTO_QUIR'], false)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. RLS — Habilitación y policy patrón Cat E
--
-- Chain de lookup:
--   registro_anestesico.acto_quirurgico_id
--     → ece.acto_quirurgico.episodio_id (o campo equivalente)
--       → ece.episodio_atencion.establecimiento_id
--
-- Nota: si acto_quirurgico usa un campo distinto (cirugía_id / encuentro_id)
-- ajustar el JOIN manteniendo el patrón Cat-E.
-- ---------------------------------------------------------------------------

ALTER TABLE ece.registro_anestesico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reg_anest_by_acto_estab ON ece.registro_anestesico;
CREATE POLICY reg_anest_by_acto_estab
    ON ece.registro_anestesico
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1
          FROM ece.acto_quirurgico aq
          JOIN ece.episodio_atencion ea ON ea.id = aq.episodio_id
         WHERE aq.id = ece.registro_anestesico.acto_quirurgico_id
           AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
    ));

COMMENT ON POLICY reg_anest_by_acto_estab ON ece.registro_anestesico IS
    'RLS Cat-E: filtra por establecimiento del episodio de atención del acto quirúrgico. '
    'Compatible con withEceContext / applyWorkflowContext (SET LOCAL app.establecimiento_id).';
