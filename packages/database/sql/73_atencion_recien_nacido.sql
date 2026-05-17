-- ============================================================================
-- 73_atencion_recien_nacido.sql
--
-- Patch sobre la tabla `ece.atencion_recien_nacido` creada en SQL 72.
--
-- Estructura existente (SQL 72):
--   id, episodio_obs_id → ece.episodio_atencion(id),
--   paciente_madre_id, paciente_rn_id, peso_g, talla_cm, perimetro_cefalico_cm,
--   sexo, edad_gestacional_semanas, hora_nacimiento, apgar_1min, apgar_5min,
--   apgar_10min, apgar_desglose (JSONB), reanimacion_requerida,
--   reanimacion_protocolo_nrp_aplicado (JSONB), malformaciones_visibles,
--   alimentacion_inicial (TEXT CHECK), estado_documento, firmado_por, firmado_en,
--   registrado_por → ece.personal_salud(id), registrado_en, estado_registro.
--
-- Este script (patch idempotente):
--   + instancia_id → ece.documento_instancia(id)   (motor workflow)
--   + atendido_por → ece.personal_salud(id)         (pediatra MC, firma)
--   + Índices de búsqueda frecuente
--   + Tipo documento ATN_RN en ece.tipo_documento
--   + RLS Cat-E: episodio_obs_id → ece.episodio_atencion.establecimiento_id
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas adicionales (idempotente)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'ece' AND table_name = 'atencion_recien_nacido'
           AND column_name = 'instancia_id'
    ) THEN
        ALTER TABLE ece.atencion_recien_nacido
          ADD COLUMN instancia_id UUID
            REFERENCES ece.documento_instancia(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'ece' AND table_name = 'atencion_recien_nacido'
           AND column_name = 'atendido_por'
    ) THEN
        ALTER TABLE ece.atencion_recien_nacido
          ADD COLUMN atendido_por UUID
            REFERENCES ece.personal_salud(id);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Índices (idempotente)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_atn_rn_episodio_obs') THEN
        CREATE INDEX idx_atn_rn_episodio_obs  ON ece.atencion_recien_nacido (episodio_obs_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_atn_rn_paciente_madre') THEN
        CREATE INDEX idx_atn_rn_paciente_madre ON ece.atencion_recien_nacido (paciente_madre_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_atn_rn_paciente_rn') THEN
        CREATE INDEX idx_atn_rn_paciente_rn    ON ece.atencion_recien_nacido (paciente_rn_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_atn_rn_estado_doc') THEN
        CREATE INDEX idx_atn_rn_estado_doc     ON ece.atencion_recien_nacido (estado_documento);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_atn_rn_instancia') THEN
        CREATE INDEX idx_atn_rn_instancia      ON ece.atencion_recien_nacido (instancia_id)
            WHERE instancia_id IS NOT NULL;
    END IF;
END $$;

COMMENT ON TABLE ece.atencion_recien_nacido IS
    'NTEC Doc ATN_RN. Atención del recién nacido en sala de expulsión. '
    'paciente_rn_id se crea atómicamente en el router con motherPatientId = paciente_madre_id. '
    'Firma electrónica requerida del pediatra (rol MC). '
    'Norma: Acuerdo n.° 1616 (MINSAL, 2024).';

-- ---------------------------------------------------------------------------
-- 3. Tipo de documento ATN_RN (idempotente)
-- ---------------------------------------------------------------------------

INSERT INTO ece.tipo_documento
    (codigo, nombre, tabla_datos, tipo_registro, modalidad, depende_de, inmutable)
VALUES
    ('ATN_RN', 'Atención Recién Nacido',
     'atencion_recien_nacido', 'maestro', 'hospitalario',
     ARRAY['HOJA_ING'], false)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. RLS Cat-E (episodio_obs_id → ece.episodio_atencion.establecimiento_id)
-- ---------------------------------------------------------------------------

ALTER TABLE ece.atencion_recien_nacido ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atn_rn_by_episodio_estab ON ece.atencion_recien_nacido;
CREATE POLICY atn_rn_by_episodio_estab
    ON ece.atencion_recien_nacido
    FOR ALL TO authenticated
    USING (
        ece.atencion_recien_nacido.episodio_obs_id IN (
            SELECT id FROM ece.episodio_atencion
             WHERE establecimiento_id = ece.current_establecimiento_id_safe()
        )
    );

COMMENT ON POLICY atn_rn_by_episodio_estab ON ece.atencion_recien_nacido IS
    'RLS Cat-E: filtra por establecimiento via episodio_obs_id → episodio_atencion. '
    'Compatible con withWorkflowContext (SET LOCAL app.establecimiento_id).';
