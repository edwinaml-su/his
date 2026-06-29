-- =============================================================================
-- 185_cc0007_lesion_causa_externa.sql
-- CC-0007 · REQ-ECE-LCE-001 — Formulario de Lesión de Causa Externa
-- Tabla epidemiológica MINSAL ligada al episodio de atención.
-- Idempotente: CREATE TABLE IF NOT EXISTS + DO $$ para índice + policy DROP/CREATE.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ece.lesion_causa_externa (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  instancia_id                    UUID        REFERENCES ece.documento_instancia(id),
  episodio_id                     UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
  paciente_id                     UUID        REFERENCES ece.paciente(id),

  -- II — Datos generales
  evento_fecha_hora               TIMESTAMPTZ,
  discapacidad                    BOOLEAN,
  tipo_evento                     TEXT[]      NOT NULL DEFAULT '{}',
  tipo_evento_otro                TEXT,
  lugar_departamento              TEXT,
  lugar_municipio                 TEXT,
  lugar_direccion                 TEXT,
  mecanismo                       TEXT[]      NOT NULL DEFAULT '{}',
  mecanismo_otro                  TEXT,
  mec_explosion                   TEXT[]      NOT NULL DEFAULT '{}',
  mec_fuego                       TEXT[]      NOT NULL DEFAULT '{}',
  mec_intoxicacion                TEXT[]      NOT NULL DEFAULT '{}',
  mec_intoxicacion_otro           TEXT,
  mec_mordedura                   TEXT[]      NOT NULL DEFAULT '{}',
  mec_mordedura_otro              TEXT,
  intencionalidad                 TEXT[]      NOT NULL DEFAULT '{}',
  intencionalidad_otro            TEXT,
  lugar                           TEXT[]      NOT NULL DEFAULT '{}',
  lugar_otro                      TEXT,
  actividad                       TEXT[]      NOT NULL DEFAULT '{}',
  actividad_otro                  TEXT,

  -- III — Datos específicos
  transporte_victima              TEXT[]      NOT NULL DEFAULT '{}',
  transporte_victima_otro         TEXT,
  contraparte                     TEXT[]      NOT NULL DEFAULT '{}',
  contraparte_otro                TEXT,
  usuario_via                     TEXT[]      NOT NULL DEFAULT '{}',
  tipo_accidente                  TEXT[]      NOT NULL DEFAULT '{}',
  tipo_accidente_otro             TEXT,
  violencia_relacion              TEXT[]      NOT NULL DEFAULT '{}',
  violencia_relacion_otro         TEXT,
  violencia_contexto              TEXT[]      NOT NULL DEFAULT '{}',
  violencia_contexto_otro         TEXT,
  violencia_autoinfligida         TEXT[]      NOT NULL DEFAULT '{}',
  violencia_autoinfligida_otro    TEXT,

  -- IV — Datos clínicos
  severidad                       TEXT[]      NOT NULL DEFAULT '{}',
  glasgow_total                   SMALLINT    CHECK (glasgow_total BETWEEN 3 AND 15),
  glasgow_categoria               VARCHAR(20),
  mapa_corporal_sitios            JSONB,
  diagnostico_naturaleza          TEXT,
  sitio_anatomico                 TEXT,
  destino                         TEXT[]      NOT NULL DEFAULT '{}',

  -- Auditoría / workflow
  registrado_por                  UUID        NOT NULL REFERENCES ece.personal_salud(id),
  registrado_en                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado_registro                 VARCHAR(20) NOT NULL DEFAULT 'borrador'
                                    CHECK (estado_registro IN ('borrador', 'firmado')),
  firmado_en                      TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_lce_episodio') THEN
    CREATE INDEX idx_lce_episodio ON ece.lesion_causa_externa(episodio_id);
  END IF;
END;
$$;

COMMENT ON TABLE ece.lesion_causa_externa IS
  'CC-0007 REQ-ECE-LCE-001. Formulario epidemiológico de lesión de causa externa '
  'ligado al episodio. Multi-selects como text[] de etiquetas canónicas; mapa '
  'corporal como JSONB [{key,label}]. Estados: borrador → firmado.';

-- RLS: acceso por establecimiento del episodio (mismo patrón que 65_ece_rls_hardening).
ALTER TABLE ece.lesion_causa_externa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS by_episodio_estab ON ece.lesion_causa_externa;
CREATE POLICY by_episodio_estab ON ece.lesion_causa_externa
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ece.episodio_atencion ea
     WHERE ea.id = ece.lesion_causa_externa.episodio_id
       AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON ece.lesion_causa_externa TO authenticated;
