-- ============================================================================
-- 66_valoracion_inicial_enfermeria.sql
--
-- Tabla `ece.valoracion_inicial_enfermeria` — valoración de ingreso (one-shot).
--
-- NTEC §4 distingue:
--   - registro_enfermeria: transaccional por turno (Doc 7).
--   - valoracion_inicial_enfermeria: maestro one-per-episodio, al ingreso.
--
-- FK: episodio_hospitalario_id → ece.episodio_hospitalario(id)
-- RLS: patrón Cat E (FK episodio→atencion→establecimiento).
-- Tipo documento: VAL_INI_ENF (idempotente en ece.tipo_documento).
-- Idempotente: CREATE TABLE IF NOT EXISTS + DO $$ para índices y policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLA PRINCIPAL
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.valoracion_inicial_enfermeria (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FK a episodio hospitalario (one-shot: UNIQUE garantiza maestro).
    -- episodio_hospitalario usa episodio_id como PK (FK a episodio_atencion).
    episodio_hospitalario_id    UUID        NOT NULL
                                    REFERENCES ece.episodio_hospitalario(episodio_id)
                                    ON DELETE RESTRICT,

    -- Vincula con el motor de workflow (puede ser null si se crea antes del
    -- workflow; el router lo asigna en el mismo INSERT).
    instancia_id                UUID
                                    REFERENCES ece.documento_instancia(id)
                                    ON DELETE SET NULL,

    -- Timestamp obligatorio del momento de la valoración
    fecha_hora                  TIMESTAMPTZ NOT NULL,

    -- Antecedentes
    antecedentes_personales     TEXT,
    antecedentes_familiares     TEXT,
    alergias_conocidas          TEXT,
    medicamentos_actuales       TEXT,

    -- Escalas clínicas
    escala_braden               SMALLINT    CHECK (escala_braden BETWEEN 6 AND 23),
    escala_morse                SMALLINT    CHECK (escala_morse BETWEEN 0 AND 125),
    escala_dolor                SMALLINT    CHECK (escala_dolor BETWEEN 0 AND 10),

    -- Estado actual del paciente al ingreso
    estado_consciencia          TEXT,
    dispositivos_invasivos      TEXT,

    -- Educación y plan
    educacion_brindada          TEXT,
    plan_cuidados_inicial       TEXT,

    -- Trazabilidad
    registrado_por              UUID        NOT NULL
                                    REFERENCES ece.personal_salud(id),
    estado_registro             TEXT        NOT NULL DEFAULT 'borrador'
                                    CHECK (estado_registro IN (
                                        'borrador', 'firmado', 'validado', 'anulado'
                                    )),
    firmado_por                 UUID        REFERENCES ece.personal_salud(id),
    firmado_en                  TIMESTAMPTZ,
    validado_por                UUID        REFERENCES ece.personal_salud(id),
    validado_en                 TIMESTAMPTZ,
    registrado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Restricción de unicidad: un episodio tiene como máximo una valoración inicial
-- (no unique constraint inmediato — se permite "borrador" múltiple en la misma
-- sesión en caso de reintento, pero el router valida antes de crear).
-- Implementamos constraint parcial: solo un registro no-anulado por episodio.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_valoracion_inicial_episodio_activa'
    ) THEN
        CREATE UNIQUE INDEX uq_valoracion_inicial_episodio_activa
            ON ece.valoracion_inicial_enfermeria (episodio_hospitalario_id)
            WHERE estado_registro <> 'anulado';
    END IF;
END $$;

-- Índices de búsqueda frecuente
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_val_ini_enf_episodio') THEN
        CREATE INDEX idx_val_ini_enf_episodio
            ON ece.valoracion_inicial_enfermeria (episodio_hospitalario_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_val_ini_enf_estado') THEN
        CREATE INDEX idx_val_ini_enf_estado
            ON ece.valoracion_inicial_enfermeria (estado_registro);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_val_ini_enf_instancia') THEN
        CREATE INDEX idx_val_ini_enf_instancia
            ON ece.valoracion_inicial_enfermeria (instancia_id)
            WHERE instancia_id IS NOT NULL;
    END IF;
END $$;

COMMENT ON TABLE ece.valoracion_inicial_enfermeria IS
    'NTEC §4. Valoración inicial de enfermería al ingreso hospitalario. '
    'Registro maestro one-per-episodio. Rectificable mediante anulación + nuevo registro. '
    'Norma: Acuerdo n.° 1616 (MINSAL, 2024).';

-- ---------------------------------------------------------------------------
-- 2. TIPO DE DOCUMENTO VAL_INI_ENF (idempotente)
-- ---------------------------------------------------------------------------

INSERT INTO ece.tipo_documento
    (codigo, nombre, tabla_datos, tipo_registro, modalidad, depende_de, inmutable)
VALUES
    ('VAL_INI_ENF', 'Valoración Inicial de Enfermería',
     'valoracion_inicial_enfermeria', 'maestro', 'hospitalario',
     ARRAY['FICHA_ID'], false)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. RLS — Habilitación y policy patrón Cat E (FK episodio→establecimiento)
--
-- La tabla episodio_hospitalario FK → episodio_atencion(id).
-- La chain de lookup es:
--   valoracion_inicial_enfermeria.episodio_hospitalario_id
--     → ece.episodio_hospitalario.episodio_id
--       → ece.episodio_atencion.establecimiento_id
-- ---------------------------------------------------------------------------

ALTER TABLE ece.valoracion_inicial_enfermeria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS val_ini_enf_by_episodio_estab ON ece.valoracion_inicial_enfermeria;
CREATE POLICY val_ini_enf_by_episodio_estab
    ON ece.valoracion_inicial_enfermeria
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1
          FROM ece.episodio_hospitalario eh
          JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_id
         WHERE eh.episodio_id = ece.valoracion_inicial_enfermeria.episodio_hospitalario_id
           AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
    ));

COMMENT ON POLICY val_ini_enf_by_episodio_estab ON ece.valoracion_inicial_enfermeria IS
    'RLS Cat-E: filtra por establecimiento del episodio de atención. '
    'Compatible con withEceContext / applyWorkflowContext (SET LOCAL app.establecimiento_id).';
