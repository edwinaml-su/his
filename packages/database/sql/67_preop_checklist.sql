-- =====================================================================
-- 67_preop_checklist.sql
-- ECE — Lista de Verificación Preoperatoria (PREOP_CHECK).
-- NTEC Art. 28, Acuerdo n.° 1616 (MINSAL 2024). Fase 2 ECE Stream Qx.
--
-- Estrategia de workflow:
--   borrador → firmado  (acción 'firmar', rol MC — firma electrónica PIN)
--   Solo INSERT, inmutable después de firma (trigger en BD).
--
-- RLS Cat-E: datos clínicos por establecimiento (JOIN episodio_atencion).
-- Idempotente: CREATE IF NOT EXISTS + DO $$ para índices y policies.
-- Aplicar vía mcp__supabase__apply_migration.
-- =====================================================================

-- -----------------------------------------------------------------------
-- 1. Tabla principal
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.preop_checklist (
    id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Motor de workflow
    instancia_id                    UUID        NOT NULL
                                        REFERENCES ece.documento_instancia(id),

    -- FK al episodio hospitalario (desnormalizada para queries directas)
    episodio_hospitalario_id        UUID        NOT NULL
                                        REFERENCES ece.episodio_hospitalario(episodio_id),

    -- -----------------------------------------------------------------------
    -- Ítems clínicos obligatorios (NTEC Art. 28 checklist mínimo)
    -- -----------------------------------------------------------------------
    ayuno_horas                     SMALLINT    CHECK (ayuno_horas BETWEEN 0 AND 24),
    marcapasos                      BOOLEAN,
    alergias                        TEXT,
    anticoagulantes                 BOOLEAN,
    retiro_protesis                 BOOLEAN,
    identificacion_paciente_verificada BOOLEAN,
    sitio_marcado                   BOOLEAN,
    consentimiento_firmado          BOOLEAN,
    riesgo_anestesico_asa           SMALLINT    CHECK (riesgo_anestesico_asa BETWEEN 1 AND 5),

    -- -----------------------------------------------------------------------
    -- Trazabilidad y workflow
    -- -----------------------------------------------------------------------
    estado_registro                 TEXT        NOT NULL DEFAULT 'vigente'
                                        CHECK (estado_registro IN ('vigente', 'rectificado')),
    firmado_por                     UUID        REFERENCES ece.personal_salud(id),
    firmado_en                      TIMESTAMPTZ,
    registrado_por                  UUID        NOT NULL
                                        REFERENCES ece.personal_salud(id),
    registrado_en                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_preop_instancia') THEN
        CREATE INDEX idx_preop_instancia
            ON ece.preop_checklist(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_preop_episodio_hosp') THEN
        CREATE INDEX idx_preop_episodio_hosp
            ON ece.preop_checklist(episodio_hospitalario_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_preop_firmado_por') THEN
        CREATE INDEX idx_preop_firmado_por
            ON ece.preop_checklist(firmado_por)
            WHERE firmado_por IS NOT NULL;
    END IF;
END $$;

COMMENT ON TABLE ece.preop_checklist IS
    'NTEC Art. 28. Lista de verificación preoperatoria. '
    'Inmutable después de firma MC. '
    'Tipo documento: PREOP_CHECK. '
    'Retención: 10 años (Art. 56 NTEC).';

-- -----------------------------------------------------------------------
-- 2. Seed del tipo de documento PREOP_CHECK en el catálogo ECE
--    Columnas: codigo, nombre, tabla_datos, tipo_registro, inmutable, activo
--    (idempotente: INSERT … ON CONFLICT DO NOTHING)
-- -----------------------------------------------------------------------
INSERT INTO ece.tipo_documento (codigo, nombre, tabla_datos, tipo_registro, modalidad, inmutable, activo)
VALUES (
    'PREOP_CHECK',
    'Lista de verificación preoperatoria (NTEC Art. 28)',
    'ece.preop_checklist',
    'transaccional',
    'hospitalario',
    true,
    true
)
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------
-- 3. RLS — Categoría E (datos clínicos por establecimiento)
--    Misma estrategia que historia_clinica, signos_vitales, etc.
--    Policy: SELECT/INSERT solo si el establecimiento del episodio_atencion
--    coincide con app.ece_establecimiento_id.
-- -----------------------------------------------------------------------
ALTER TABLE ece.preop_checklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS preop_select_by_estab ON ece.preop_checklist;
CREATE POLICY preop_select_by_estab
    ON ece.preop_checklist
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM ece.episodio_hospitalario eh
            JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_id
            WHERE eh.episodio_id = preop_checklist.episodio_hospitalario_id
              AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
        )
    );

DROP POLICY IF EXISTS preop_insert_by_estab ON ece.preop_checklist;
CREATE POLICY preop_insert_by_estab
    ON ece.preop_checklist
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM ece.episodio_hospitalario eh
            JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_id
            WHERE eh.episodio_id = preop_checklist.episodio_hospitalario_id
              AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
        )
    );

-- UPDATE solo del campo estado_registro (rectificación) y campos de firma.
-- Los campos clínicos son inmutables post-firma (se hace cumplir por trigger).
DROP POLICY IF EXISTS preop_update_firma ON ece.preop_checklist;
CREATE POLICY preop_update_firma
    ON ece.preop_checklist
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM ece.episodio_hospitalario eh
            JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_id
            WHERE eh.episodio_id = preop_checklist.episodio_hospitalario_id
              AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
        )
    );

-- -----------------------------------------------------------------------
-- 4. Trigger de inmutabilidad post-firma
--    Bloquea cualquier UPDATE a columnas clínicas una vez firmado_en IS NOT NULL.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ece.preop_checklist_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Si el registro ya está firmado, bloquear cambios en columnas clínicas.
    IF OLD.firmado_en IS NOT NULL THEN
        RAISE EXCEPTION
            'preop_checklist id=% ya está firmado. Inmutabilidad NTEC Art. 28.',
            OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preop_immutable ON ece.preop_checklist;
CREATE TRIGGER trg_preop_immutable
    BEFORE UPDATE ON ece.preop_checklist
    FOR EACH ROW
    WHEN (OLD.firmado_en IS NOT NULL)
    EXECUTE FUNCTION ece.preop_checklist_immutable();
