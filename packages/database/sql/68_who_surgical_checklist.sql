-- =====================================================================
-- 68_who_surgical_checklist.sql
-- WHO Surgical Safety Checklist (OMS Cirugía Segura, 2009).
-- 3 fases: sign-in (pre-anestesia), time-out (pre-incisión), sign-out (post-cierre).
--
-- FK: acto_quirurgico_id → ece.acto_quirurgico(id)
-- RLS: Cat-E (patrón GUC app.ece_establecimiento_id vía ece.set_ece_context).
-- Tipo documento: WHO_CHK (idempotente en ece.tipo_documento).
-- Idempotente: CREATE TABLE IF NOT EXISTS + DO $$ para índices y policies.
-- =====================================================================

-- -----------------------------------------------------------------------
-- 1. TABLA PRINCIPAL
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.who_checklist (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FK al acto quirúrgico al que pertenece este checklist (uno-a-uno).
    acto_quirurgico_id      UUID        NOT NULL
                                REFERENCES ece.acto_quirurgico(id)
                                ON DELETE RESTRICT,

    -- Estado global del checklist (secuencial: solo avanza, nunca retrocede).
    estado                  TEXT        NOT NULL DEFAULT 'iniciado'
                                CHECK (estado IN (
                                    'iniciado',
                                    'sign_in_completo',
                                    'time_out_completo',
                                    'completo'
                                )),

    -- ---------------------------------------------------------------
    -- Fase 1: Sign-In (pre-anestesia, antes de inducción)
    -- Items estándar WHO 2009 §1
    -- ---------------------------------------------------------------
    fase_sign_in            JSONB,
    -- Estructura esperada:
    -- {
    --   "completado_en": "ISO8601",
    --   "responsable_id": "uuid",
    --   "responsable_nombre": "string",
    --   "items": [
    --     {"clave": "identidad_confirmada",       "label": "Identidad del paciente confirmada", "verificado": bool, "observacion": "string|null"},
    --     {"clave": "sitio_marcado",              "label": "Sitio quirúrgico marcado",           "verificado": bool},
    --     {"clave": "consentimiento_firmado",     "label": "Consentimiento informado firmado",   "verificado": bool},
    --     {"clave": "equipo_anestesia_completo",  "label": "Equipo de anestesia completo y verificado", "verificado": bool},
    --     {"clave": "pulsioximetro_funcional",    "label": "Pulsioxímetro funcional colocado",   "verificado": bool},
    --     {"clave": "alergias_conocidas",         "label": "Alergias conocidas",                 "verificado": bool, "detalle": "string|null"},
    --     {"clave": "via_aerea_dificil",          "label": "Riesgo vía aérea difícil evaluado",  "verificado": bool},
    --     {"clave": "riesgo_hemorragia",          "label": "Riesgo de hemorragia evaluado",       "verificado": bool}
    --   ]
    -- }

    -- ---------------------------------------------------------------
    -- Fase 2: Time-Out (pre-incisión, todo el equipo presente)
    -- Items estándar WHO 2009 §2
    -- ---------------------------------------------------------------
    fase_time_out           JSONB,
    -- Estructura esperada:
    -- {
    --   "completado_en": "ISO8601",
    --   "responsable_id": "uuid",
    --   "responsable_nombre": "string",
    --   "items": [
    --     {"clave": "equipo_presentado",          "label": "Todos se han presentado",                    "verificado": bool},
    --     {"clave": "paciente_confirmado",        "label": "Paciente, sitio y procedimiento confirmados", "verificado": bool},
    --     {"clave": "antibiotico_profilactico",   "label": "Antibiótico profiláctico administrado <60 min","verificado": bool},
    --     {"clave": "imagenes_disponibles",       "label": "Estudios de imagen esenciales disponibles",   "verificado": bool},
    --     {"clave": "eventos_criticos_discutidos","label": "Eventos críticos discutidos con el equipo",   "verificado": bool},
    --     {"clave": "duracion_estimada",          "label": "Duración estimada de la cirugía",             "verificado": bool, "detalle": "string|null"},
    --     {"clave": "esterilizacion_instrumental","label": "Esterilización del instrumental confirmada",  "verificado": bool}
    --   ]
    -- }

    -- ---------------------------------------------------------------
    -- Fase 3: Sign-Out (post-cierre, antes de que el paciente salga)
    -- Items estándar WHO 2009 §3
    -- ---------------------------------------------------------------
    fase_sign_out           JSONB,
    -- Estructura esperada:
    -- {
    --   "completado_en": "ISO8601",
    --   "responsable_id": "uuid",
    --   "responsable_nombre": "string",
    --   "items": [
    --     {"clave": "procedimiento_confirmado",   "label": "Procedimiento realizado confirmado",           "verificado": bool},
    --     {"clave": "conteo_instrumental",        "label": "Conteo de instrumental, gasas y agujas correcto","verificado": bool},
    --     {"clave": "etiquetado_muestras",        "label": "Muestras etiquetadas correctamente",           "verificado": bool},
    --     {"clave": "problemas_equipo",           "label": "Problemas del equipo reportados",              "verificado": bool, "observacion": "string|null"},
    --     {"clave": "plan_postoperatorio",        "label": "Plan postoperatorio comunicado a enfermería",   "verificado": bool}
    --   ]
    -- }

    -- Trazabilidad
    registrado_por          UUID        NOT NULL
                                REFERENCES ece.personal_salud(id),
    registrado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Restricción: un acto quirúrgico tiene como máximo un checklist WHO.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_who_checklist_acto'
    ) THEN
        ALTER TABLE ece.who_checklist
            ADD CONSTRAINT uq_who_checklist_acto
            UNIQUE (acto_quirurgico_id);
    END IF;
END $$;

-- Índices operativos
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_who_acto') THEN
        CREATE INDEX idx_who_acto ON ece.who_checklist(acto_quirurgico_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_who_estado') THEN
        CREATE INDEX idx_who_estado ON ece.who_checklist(estado);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_who_registrado_en') THEN
        CREATE INDEX idx_who_registrado_en ON ece.who_checklist(registrado_en DESC);
    END IF;
END $$;

COMMENT ON TABLE ece.who_checklist IS
    'WHO Surgical Safety Checklist (OMS Cirugía Segura 2009). '
    'Tres fases secuenciales: sign_in → time_out → completo. '
    'One-per-acto-quirurgico (UNIQUE). RLS Cat-E por establecimiento.';

-- -----------------------------------------------------------------------
-- 2. TIPO DOCUMENTO WHO_CHK (idempotente)
-- -----------------------------------------------------------------------

INSERT INTO ece.tipo_documento (codigo, nombre, descripcion, es_inmutable)
VALUES (
    'WHO_CHK',
    'WHO Surgical Safety Checklist',
    'Lista de verificación de seguridad quirúrgica OMS 2009 (3 fases).',
    false   -- mutable hasta estado "completo"; el router aplica lógica de inmutabilidad post-sign-out
)
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------
-- 3. TRIGGER: actualizado_en automático
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.fn_who_checklist_updated_en()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.actualizado_en := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_who_checklist_updated ON ece.who_checklist;
CREATE TRIGGER trg_who_checklist_updated
    BEFORE UPDATE ON ece.who_checklist
    FOR EACH ROW EXECUTE FUNCTION ece.fn_who_checklist_updated_en();

-- -----------------------------------------------------------------------
-- 4. RLS — Cat-E (patrón GUC, análogo a ece.acto_quirurgico)
-- -----------------------------------------------------------------------

ALTER TABLE ece.who_checklist ENABLE ROW LEVEL SECURITY;

-- Personal del mismo establecimiento puede leer (vía JOIN a acto_quirurgico → episodio_atencion)
DROP POLICY IF EXISTS who_checklist_select ON ece.who_checklist;
CREATE POLICY who_checklist_select ON ece.who_checklist
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM ece.acto_quirurgico aq
            JOIN ece.episodio_atencion ea ON ea.id = aq.episodio_id
            WHERE aq.id = who_checklist.acto_quirurgico_id
              AND ea.establecimiento_id = ece.current_establecimiento_id()
        )
    );

-- Inserción: solo personal del establecimiento
DROP POLICY IF EXISTS who_checklist_insert ON ece.who_checklist;
CREATE POLICY who_checklist_insert ON ece.who_checklist
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM ece.acto_quirurgico aq
            JOIN ece.episodio_atencion ea ON ea.id = aq.episodio_id
            WHERE aq.id = who_checklist.acto_quirurgico_id
              AND ea.establecimiento_id = ece.current_establecimiento_id()
        )
    );

-- Update: solo hasta que el checklist no esté completo
DROP POLICY IF EXISTS who_checklist_update ON ece.who_checklist;
CREATE POLICY who_checklist_update ON ece.who_checklist
    FOR UPDATE
    USING (
        estado <> 'completo'
        AND EXISTS (
            SELECT 1
            FROM ece.acto_quirurgico aq
            JOIN ece.episodio_atencion ea ON ea.id = aq.episodio_id
            WHERE aq.id = who_checklist.acto_quirurgico_id
              AND ea.establecimiento_id = ece.current_establecimiento_id()
        )
    );

-- Sin DELETE (append-only)
DROP POLICY IF EXISTS who_checklist_delete ON ece.who_checklist;
