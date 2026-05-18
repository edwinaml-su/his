-- =============================================================================
-- §71 Partograma OMS — Registro de dilatación cervical y alertas automáticas
-- Norma: NTEC Doc 14 Obstétrico, OMS partograma 1994 (curvas alerta/acción).
-- Tabla hija de ece.documentos_obstetricos.
-- RLS Categoría-E: solo personal del episodio activo puede leer/escribir.
-- =============================================================================

-- Asegurar columna doc_obstetrico_id si no existe (FK a tabla ya existente)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ece'
      AND table_name   = 'documentos_obstetricos'
      AND column_name  = 'doc_obstetrico_id'
  ) THEN
    -- La PK ya es "id"; la FK la usamos desde partograma_registro hacia id.
    -- No se añade columna extra; partograma_registro referencia directamente id.
    NULL;
  END IF;
END $$;

-- =============================================================================
-- Tabla principal
-- =============================================================================
CREATE TABLE IF NOT EXISTS ece.partograma_registro (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_obstetrico_id       UUID        NOT NULL
                                REFERENCES ece.documentos_obstetricos(id)
                                ON DELETE RESTRICT,
    episodio_id             UUID        NOT NULL
                                REFERENCES ece.episodio_atencion(id)
                                ON DELETE RESTRICT,
    -- Timestamp de la lectura clínica (puede diferir de created_at si se registra retroactivo)
    registrado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Signos obstétricos OMS
    dilatacion_cm           NUMERIC(3,1) NOT NULL
                                CHECK (dilatacion_cm >= 0 AND dilatacion_cm <= 10),
    borramiento_pct         SMALLINT
                                CHECK (borramiento_pct BETWEEN 0 AND 100),
    posicion_fetal          TEXT
                                CHECK (posicion_fetal IN (
                                    'OIA','OIP','ODA','ODP',
                                    'OIIA','OIIP','ODIA','ODIP',
                                    'presentacion_cara','presentacion_frente','otro'
                                )),
    frecuencia_cardiaca_fetal  SMALLINT
                                CHECK (frecuencia_cardiaca_fetal BETWEEN 60 AND 200),
    contracciones_10min     SMALLINT
                                CHECK (contracciones_10min BETWEEN 0 AND 10),
    intensidad              TEXT
                                CHECK (intensidad IN ('leve','moderada','fuerte')),
    dolor_paciente          SMALLINT
                                -- EVA 0-10
                                CHECK (dolor_paciente BETWEEN 0 AND 10),
    medicamentos            TEXT,
    observaciones           TEXT,
    -- Alertas OMS calculadas en INSERT/UPDATE trigger y por router
    alerta_oms              TEXT
                                CHECK (alerta_oms IN (
                                    'normal',
                                    'zona_alerta',
                                    'zona_accion'
                                )) DEFAULT 'normal',
    -- Audit
    registrado_por          UUID        NOT NULL
                                REFERENCES ece.personal_salud(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- Índices
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_parto_doc_obs') THEN
    CREATE INDEX idx_parto_doc_obs
      ON ece.partograma_registro(doc_obstetrico_id, registrado_en);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_parto_episodio') THEN
    CREATE INDEX idx_parto_episodio
      ON ece.partograma_registro(episodio_id, registrado_en);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_parto_alerta') THEN
    CREATE INDEX idx_parto_alerta
      ON ece.partograma_registro(alerta_oms)
      WHERE alerta_oms <> 'normal';
  END IF;
END $$;

COMMENT ON TABLE ece.partograma_registro IS
  'NTEC Doc 14. Lecturas seriadas del partograma OMS. '
  'dilatacion_cm 0-10 + curva alerta/accion calculada por router detectarAlertasOMS. '
  'RLS Cat-E: personal del episodio activo únicamente.';

-- =============================================================================
-- RLS Categoría-E
-- =============================================================================
ALTER TABLE ece.partograma_registro ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Política lectura: personal autenticado del mismo episodio
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'ece'
      AND tablename  = 'partograma_registro'
      AND policyname = 'prt_read_personal'
  ) THEN
    CREATE POLICY prt_read_personal ON ece.partograma_registro
      FOR SELECT
      TO authenticated
      USING (
        episodio_id IN (
          SELECT ep.id
          FROM ece.episodio_atencion ep
          WHERE ep.establecimiento_id = (
            current_setting('app.current_org_id', true)::UUID
          )
        )
      );
  END IF;

  -- Política escritura: PHYSICIAN / NURSE / MT del episodio
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'ece'
      AND tablename  = 'partograma_registro'
      AND policyname = 'prt_write_personal'
  ) THEN
    CREATE POLICY prt_write_personal ON ece.partograma_registro
      FOR ALL
      TO authenticated
      USING (
        episodio_id IN (
          SELECT ep.id
          FROM ece.episodio_atencion ep
          WHERE ep.establecimiento_id = (
            current_setting('app.current_org_id', true)::UUID
          )
        )
      )
      WITH CHECK (
        episodio_id IN (
          SELECT ep.id
          FROM ece.episodio_atencion ep
          WHERE ep.establecimiento_id = (
            current_setting('app.current_org_id', true)::UUID
          )
        )
      );
  END IF;
END $$;
