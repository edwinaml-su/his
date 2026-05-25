-- =============================================================================
-- 119_fall_event.sql
-- JCI IPSG.6 — Registro de eventos de caída de paciente
-- US.JCI.5.16 | Sprint S3 | 2026-05-24
-- Nota: este archivo crea la tabla base. La matview KPI (US.JCI.5.17) vive
--       en 122_kpi_falls_rate.sql y depende de esta tabla.
-- =============================================================================

-- Enum: lesión resultante (clasificación JCI estándar)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fall_lesion_type' AND typnamespace = 'ece'::regnamespace) THEN
    CREATE TYPE ece.fall_lesion_type AS ENUM (
      'ninguna',
      'leve',
      'moderada',
      'grave',
      'muy_grave'
    );
  END IF;
END
$$;

-- Enum: categoría de caída (escala Morse simplificada)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fall_category' AND typnamespace = 'ece'::regnamespace) THEN
    CREATE TYPE ece.fall_category AS ENUM (
      'accidental',
      'fisiologica_anticipada',
      'fisiologica_no_anticipada'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS ece.fall_event (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant: establecimiento (sin organization_id directo en ece — se resuelve
  -- por join con episodio_atencion.establecimiento_id)
  establecimiento_id    UUID NOT NULL
                          REFERENCES ece.establecimiento(id) ON DELETE RESTRICT,

  -- Episodio clínico asociado (JOIN a episodio_atencion)
  episodio_id           UUID NOT NULL
                          REFERENCES ece.episodio_atencion(id) ON DELETE RESTRICT,

  -- Datos del evento
  fecha_hora            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ubicacion             TEXT,                        -- texto libre (servicio, pasillo, baño…)
  servicio_id           UUID REFERENCES ece.servicio(id) ON DELETE SET NULL,

  -- Clasificación
  categoria             ece.fall_category NOT NULL DEFAULT 'accidental',
  lesion_resultante     ece.fall_lesion_type NOT NULL DEFAULT 'ninguna',

  -- Evaluación de riesgo previo (Morse score, si disponible)
  morse_score           SMALLINT CHECK (morse_score BETWEEN 0 AND 125),

  -- Descripción narrativa del evento
  descripcion           TEXT,

  -- Notificación JCI requerida si lesión >= moderada
  notificado_jci        BOOLEAN NOT NULL DEFAULT FALSE,
  notificado_en         TIMESTAMPTZ,

  -- Auditoría
  reportado_por         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de soporte
CREATE INDEX IF NOT EXISTS idx_fall_event_establecimiento_fecha
  ON ece.fall_event (establecimiento_id, fecha_hora DESC);

CREATE INDEX IF NOT EXISTS idx_fall_event_episodio
  ON ece.fall_event (episodio_id);

CREATE INDEX IF NOT EXISTS idx_fall_event_lesion
  ON ece.fall_event (lesion_resultante)
  WHERE lesion_resultante IN ('moderada', 'grave', 'muy_grave');

-- Trigger: actualiza actualizado_en
CREATE OR REPLACE FUNCTION ece.fall_event_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fall_event_updated_at ON ece.fall_event;
CREATE TRIGGER trg_fall_event_updated_at
  BEFORE UPDATE ON ece.fall_event
  FOR EACH ROW EXECUTE FUNCTION ece.fall_event_updated_at();

-- RLS
ALTER TABLE ece.fall_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fall_event_establecimiento_policy ON ece.fall_event;
CREATE POLICY fall_event_establecimiento_policy ON ece.fall_event
  USING (establecimiento_id = (current_setting('app.ece_establecimiento_id', TRUE))::UUID);

COMMENT ON TABLE ece.fall_event IS
  'JCI IPSG.6 ME — Registro de eventos de caída de paciente. '
  'Fuente para el KPI tasa/1000 días-cama (matview analytics.kpi_falls_rate_monthly). '
  'US.JCI.5.16. Lesión >= moderada requiere notificación JCI.';
