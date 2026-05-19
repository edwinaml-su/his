-- ============================================================================
-- 70_urpa_recovery.sql
-- URPA — Unidad Recuperación Post-Anestésica
--
-- Tabla: ece.urpa_recovery
-- FK:    acto_quirurgico_id → ece.acto_quirurgico(id)
-- RLS:   Cat-E (via establecimiento_id del acto quirúrgico)
-- Tipo doc: URPA
-- Idempotente: IF NOT EXISTS + DO $$ guards.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLA PRINCIPAL
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.urpa_recovery (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FK al acto quirúrgico que origina el ingreso a URPA.
    acto_quirurgico_id          UUID        NOT NULL
                                    REFERENCES ece.acto_quirurgico(id)
                                    ON DELETE RESTRICT,

    -- Timestamps del ciclo URPA
    ingreso_urpa_ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
    alta_urpa_ts                TIMESTAMPTZ,

    -- Escala Aldrete al ingreso (0-10 puntos): actividad motora, respiración,
    -- circulación, consciencia, SpO2. Cada ítem 0-2 → total 0-10.
    escala_aldrete_ingreso      SMALLINT    NOT NULL
                                    CHECK (escala_aldrete_ingreso BETWEEN 0 AND 10),

    -- Escala Aldrete al alta (requerida cuando se registra el alta).
    escala_aldrete_alta         SMALLINT
                                    CHECK (escala_aldrete_alta BETWEEN 0 AND 10),

    -- Medicamentos administrados durante la estancia URPA.
    -- Formato: [{ nombre, dosis, via, administrado_en }]
    medicamentos_administrados  JSONB       NOT NULL DEFAULT '[]'::jsonb,

    -- Complicaciones observadas durante la recuperación.
    complicaciones              TEXT,

    -- Criterio de alta: cumple Aldrete ≥9, observación o traslado a UCI.
    criterio_alta               TEXT
                                    CHECK (criterio_alta IN (
                                        'cumple',
                                        'no_cumple_observacion',
                                        'trasladar_uci'
                                    )),

    -- Trazabilidad
    registrado_por              UUID        NOT NULL
                                    REFERENCES ece.personal_salud(id),
    alta_registrada_por         UUID
                                    REFERENCES ece.personal_salud(id),
    estado_registro             TEXT        NOT NULL DEFAULT 'activo'
                                    CHECK (estado_registro IN ('activo','alta_otorgada','anulado')),
    creado_en                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraint de integridad: alta requiere criterio_alta.
    CONSTRAINT ck_urpa_alta_requiere_criterio
        CHECK (
            alta_urpa_ts IS NULL
            OR criterio_alta IS NOT NULL
        ),

    -- Un acto quirúrgico tiene a lo sumo un registro URPA activo.
    CONSTRAINT uq_urpa_acto_activo
        EXCLUDE USING btree (acto_quirurgico_id WITH =)
        WHERE (estado_registro = 'activo')
);

COMMENT ON TABLE ece.urpa_recovery IS
    'Registro de recuperación post-anestésica (URPA). '
    'Un registro por acto quirúrgico. '
    'Alta requiere criterio_alta; Aldrete ≥9 → cumple; <9 → no_cumple_observacion o trasladar_uci.';

COMMENT ON COLUMN ece.urpa_recovery.escala_aldrete_ingreso IS
    'Escala Aldrete (0-10) al ingreso a URPA. '
    'Suma de 5 ítems (0-2 c/u): actividad motora, respiración, circulación, consciencia, SpO2.';

COMMENT ON COLUMN ece.urpa_recovery.medicamentos_administrados IS
    'Array JSONB de medicamentos. '
    'Esquema elemento: { nombre: string, dosis: string, via: string, administrado_en: timestamptz }.';

-- ---------------------------------------------------------------------------
-- 2. ÍNDICES OPERATIVOS
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_urpa_acto_quirurgico
    ON ece.urpa_recovery (acto_quirurgico_id);

CREATE INDEX IF NOT EXISTS idx_urpa_estado
    ON ece.urpa_recovery (estado_registro);

CREATE INDEX IF NOT EXISTS idx_urpa_ingreso_ts
    ON ece.urpa_recovery (ingreso_urpa_ts DESC);

-- ---------------------------------------------------------------------------
-- 3. TIPO DE DOCUMENTO URPA (seed idempotente)
-- ---------------------------------------------------------------------------

INSERT INTO ece.tipo_documento (codigo, nombre, tabla_datos, tipo_registro, modalidad, inmutable)
VALUES (
    'URPA',
    'Registro URPA — Recuperación Post-Anestésica',
    'urpa_recovery',
    'transaccional',
    'hospitalario',
    false
)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. FLUJO DE ESTADOS URPA
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_tipo_id uuid;
BEGIN
    SELECT id INTO v_tipo_id FROM ece.tipo_documento WHERE codigo = 'URPA';

    IF v_tipo_id IS NULL THEN
        RAISE EXCEPTION 'tipo_documento URPA no insertado';
    END IF;

    INSERT INTO ece.flujo_estado (tipo_documento_id, codigo, nombre, es_inicial, es_final, orden)
    VALUES
        (v_tipo_id, 'activo',        'Activo',          true,  false, 1),
        (v_tipo_id, 'alta_otorgada', 'Alta Otorgada',   false, true,  2),
        (v_tipo_id, 'anulado',       'Anulado',         false, false, 3)
    ON CONFLICT (tipo_documento_id, codigo) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS (Cat-E: chain urpa→acto_quirurgico→episodio_atencion→establecimiento_id)
-- ---------------------------------------------------------------------------

ALTER TABLE ece.urpa_recovery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS urpa_by_acto_estab ON ece.urpa_recovery;
CREATE POLICY urpa_by_acto_estab
    ON ece.urpa_recovery
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1
          FROM ece.acto_quirurgico aq
          JOIN ece.episodio_atencion ea ON ea.id = aq.episodio_id
         WHERE aq.id = ece.urpa_recovery.acto_quirurgico_id
           AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
    ));

COMMENT ON POLICY urpa_by_acto_estab ON ece.urpa_recovery IS
    'RLS Cat-E: filtra por establecimiento del episodio de atención del acto quirúrgico. '
    'Compatible con withEceContext (SET LOCAL app.establecimiento_id).';
