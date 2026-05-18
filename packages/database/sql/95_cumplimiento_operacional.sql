-- =============================================================================
-- 95_cumplimiento_operacional.sql
-- F2-S15 Stream A — Cumplimiento Operacional
-- §6 Contingencia operativa (US.F2.7.26-28)
-- §7 Conservación diferenciada y retención (US.F2.7.29-32)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- §6 CONTINGENCIA OPERATIVA
-- ---------------------------------------------------------------------------

-- Registro de períodos de contingencia (modo papel)
CREATE TABLE IF NOT EXISTS ece.contingencia_evento (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  motivo               TEXT        NOT NULL,
  esperado_hasta       TIMESTAMPTZ,
  activado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  activado_por_id      UUID        NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  desactivado_en       TIMESTAMPTZ,
  desactivado_por_id   UUID        REFERENCES public."User"(id) ON DELETE SET NULL,
  -- estado derivado: NULL desactivado_en → activo
  CONSTRAINT chk_desactivacion CHECK (
    desactivado_en IS NULL OR desactivado_en > activado_en
  )
);

CREATE INDEX IF NOT EXISTS idx_contingencia_evento_org_activo
  ON ece.contingencia_evento (organization_id, desactivado_en)
  WHERE desactivado_en IS NULL;

-- Columnas de contingencia en tablas ECE de documentos clínicos
-- signos_vitales
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS digitado_retroactivamente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timestamp_real_papel       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contingencia_evento_id     UUID REFERENCES ece.contingencia_evento(id) ON DELETE SET NULL;

-- hoja_triaje
ALTER TABLE ece.hoja_triaje
  ADD COLUMN IF NOT EXISTS digitado_retroactivamente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timestamp_real_papel       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contingencia_evento_id     UUID REFERENCES ece.contingencia_evento(id) ON DELETE SET NULL;

-- indicaciones_medicas
ALTER TABLE ece.indicaciones_medicas
  ADD COLUMN IF NOT EXISTS digitado_retroactivamente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timestamp_real_papel       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contingencia_evento_id     UUID REFERENCES ece.contingencia_evento(id) ON DELETE SET NULL;

-- evolucion_medica
ALTER TABLE ece.evolucion_medica
  ADD COLUMN IF NOT EXISTS digitado_retroactivamente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timestamp_real_papel       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contingencia_evento_id     UUID REFERENCES ece.contingencia_evento(id) ON DELETE SET NULL;

-- Índices de búsqueda retroactiva
CREATE INDEX IF NOT EXISTS idx_signos_vitales_contingencia
  ON ece.signos_vitales (contingencia_evento_id) WHERE contingencia_evento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hoja_triaje_contingencia
  ON ece.hoja_triaje (contingencia_evento_id) WHERE contingencia_evento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_indicaciones_contingencia
  ON ece.indicaciones_medicas (contingencia_evento_id) WHERE contingencia_evento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evolucion_contingencia
  ON ece.evolucion_medica (contingencia_evento_id) WHERE contingencia_evento_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- §7 CONSERVACIÓN DIFERENCIADA Y RETENCIÓN
-- ---------------------------------------------------------------------------

-- Estado de conservación de episodios
DO $$ BEGIN
  CREATE TYPE ece.estado_conservacion AS ENUM ('ACTIVO', 'PASIVO', 'POR_ELIMINAR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Añadir campo conservación a episodio_atencion
ALTER TABLE ece.episodio_atencion
  ADD COLUMN IF NOT EXISTS estado_conservacion   ece.estado_conservacion NOT NULL DEFAULT 'ACTIVO',
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_retencion TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_episodio_conservacion
  ON ece.episodio_atencion (organization_id, estado_conservacion);
CREATE INDEX IF NOT EXISTS idx_episodio_vencimiento
  ON ece.episodio_atencion (fecha_vencimiento_retencion)
  WHERE fecha_vencimiento_retencion IS NOT NULL;

-- Catálogo de reglas de retención por patrón CIE-10
CREATE TABLE IF NOT EXISTS ece.regla_retencion (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  -- Patrón SQL LIKE sobre código CIE-10 (ej. 'V%' vehicular, 'X%' causas externas)
  -- NULL = regla por defecto (aplica si ningún patrón específico coincide)
  cie10_pattern    VARCHAR(20),
  anios_retencion  INT         NOT NULL CHECK (anios_retencion > 0),
  motivo_legal     TEXT        NOT NULL,
  vigente_desde    DATE        NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta    DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id    UUID        REFERENCES public."User"(id) ON DELETE SET NULL
);

-- Índice para búsqueda de regla aplicable
CREATE INDEX IF NOT EXISTS idx_regla_retencion_org
  ON ece.regla_retencion (organization_id, cie10_pattern);

-- Insertar reglas base (10 años forense/default, 5 años base)
-- Estas son reglas organizacionales template; cada org puede tener las suyas.
-- No hay FK a org específica aquí — se insertan por org en el seed.

-- ---------------------------------------------------------------------------
-- Eliminación supervisada con doble firma
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE ece.estado_eliminacion AS ENUM ('SOLICITADA', 'APROBADA', 'RECHAZADA', 'EJECUTADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ece.eliminacion_supervisada (
  id                UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID              NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  episodio_id       UUID              NOT NULL REFERENCES ece.episodio_atencion(id) ON DELETE RESTRICT,
  solicitado_por_id UUID              NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  motivo_baja       TEXT              NOT NULL,
  estado            ece.estado_eliminacion NOT NULL DEFAULT 'SOLICITADA',
  -- Doble firma electrónica (DIR + Director Médico)
  firma_dir1_id     UUID              REFERENCES ece.firma_electronica(id) ON DELETE SET NULL,
  firma_dir2_id     UUID              REFERENCES ece.firma_electronica(id) ON DELETE SET NULL,
  fecha_aprobacion  TIMESTAMPTZ,
  fecha_rechazo     TIMESTAMPTZ,
  motivo_rechazo    TEXT,
  fecha_ejecucion   TIMESTAMPTZ,
  -- Metadata preservada permanentemente (audit)
  paciente_nombre   VARCHAR(200),
  paciente_dui      VARCHAR(20),
  regla_retencion_id UUID             REFERENCES ece.regla_retencion(id) ON DELETE SET NULL,
  fecha_vencimiento_retencion TIMESTAMPTZ,
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ       NOT NULL DEFAULT now(),
  CONSTRAINT chk_double_firma CHECK (
    estado != 'EJECUTADA' OR (firma_dir1_id IS NOT NULL AND firma_dir2_id IS NOT NULL)
  ),
  CONSTRAINT chk_firmas_distintas CHECK (
    firma_dir1_id IS NULL OR firma_dir2_id IS NULL OR firma_dir1_id != firma_dir2_id
  )
);

CREATE INDEX IF NOT EXISTS idx_eliminacion_org_estado
  ON ece.eliminacion_supervisada (organization_id, estado);
CREATE INDEX IF NOT EXISTS idx_eliminacion_episodio
  ON ece.eliminacion_supervisada (episodio_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION ece.update_eliminacion_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eliminacion_updated_at ON ece.eliminacion_supervisada;
CREATE TRIGGER trg_eliminacion_updated_at
  BEFORE UPDATE ON ece.eliminacion_supervisada
  FOR EACH ROW EXECUTE FUNCTION ece.update_eliminacion_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — habilitar en nuevas tablas
-- ---------------------------------------------------------------------------

ALTER TABLE ece.contingencia_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.regla_retencion     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.eliminacion_supervisada ENABLE ROW LEVEL SECURITY;

-- Políticas básicas tenant-scoped (lectura autenticada por org)
CREATE POLICY IF NOT EXISTS "contingencia_org_isolation"
  ON ece.contingencia_evento
  FOR ALL TO authenticated
  USING (organization_id::text = current_setting('app.current_org_id', true));

CREATE POLICY IF NOT EXISTS "regla_retencion_org_isolation"
  ON ece.regla_retencion
  FOR ALL TO authenticated
  USING (organization_id::text = current_setting('app.current_org_id', true));

CREATE POLICY IF NOT EXISTS "eliminacion_org_isolation"
  ON ece.eliminacion_supervisada
  FOR ALL TO authenticated
  USING (organization_id::text = current_setting('app.current_org_id', true));

-- ---------------------------------------------------------------------------
-- pg_cron: job nocturno para marcar PASIVO (requiere extensión pg_cron)
-- Corre a las 02:00 UTC. Marca PASIVO los episodios sin atención en 5 años.
-- ---------------------------------------------------------------------------
-- Nota: pg_cron en Supabase requiere extensión habilitada.
-- Si no está disponible, usar Edge Function programada.

SELECT cron.schedule(
  'his-retencion-pasivo-nightly',
  '0 2 * * *',
  $$
  UPDATE ece.episodio_atencion
  SET estado_conservacion = 'PASIVO'
  WHERE estado_conservacion = 'ACTIVO'
    AND fecha_cierre < now() - INTERVAL '5 years'
    AND id NOT IN (
      -- Episodios con eliminación en curso
      SELECT episodio_id FROM ece.eliminacion_supervisada
      WHERE estado IN ('SOLICITADA', 'APROBADA')
    );
  $$
) ON CONFLICT (jobname) DO UPDATE SET schedule = '0 2 * * *';
