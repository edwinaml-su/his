-- =============================================================================
-- 74_reanimacion_neonatal.sql
-- Protocolo Reanimación Neonatal NRP (AHA/AAP) — índices + RLS complementarios
-- =============================================================================
-- La tabla ece.reanimacion_neonatal fue creada en el gate F2-S1 (sprint 98).
-- Este archivo agrega índices de soporte y verifica RLS Cat-E.
--
-- Schema real (Supabase):
--   id                    UUID PK
--   atencion_rn_id        UUID NOT NULL → ece.documentos_obstetricos(id)
--   apertura_en           TIMESTAMPTZ NOT NULL DEFAULT now()
--   registrado_por        UUID NOT NULL → ece.personal_salud(id)
--   estimulacion_tactil_en TIMESTAMPTZ
--   vpp_iniciada_en       TIMESTAMPTZ   + vpp_presion_cmh2o, vpp_frecuencia_rpm, vpp_fi_o2_pct
--   intubacion_en         TIMESTAMPTZ   + tubo_size_mm, intubacion_nota
--   mce_iniciado_en       TIMESTAMPTZ   + mce_ratio
--   adrenalina_dosis_ml   NUMERIC       + adrenalina_via, adrenalina_concentracion, adrenalina_en
--   volumen_expansor_ml   NUMERIC       + volumen_expansor_tipo, volumen_expansor_en
--   fc_post_intervencion  SMALLINT      + fc_post_en
--   resultado             ece.resultado_nrp (ENUM)
--   cerrado_en            TIMESTAMPTZ   — NULL = en curso, NOT NULL = cerrado
--   cerrado_por           UUID → ece.personal_salud(id)
--   notas_cierre          TEXT
--   creado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
--   actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Índices (idempotentes)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rn_atencion_rn
  ON ece.reanimacion_neonatal (atencion_rn_id);

CREATE INDEX IF NOT EXISTS idx_rn_registrado_por
  ON ece.reanimacion_neonatal (registrado_por);

CREATE INDEX IF NOT EXISTS idx_rn_estado_apertura
  ON ece.reanimacion_neonatal (cerrado_en, apertura_en DESC);

-- ---------------------------------------------------------------------------
-- RLS — Cat-E (si no están ya habilitadas por el gate anterior)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE ece.reanimacion_neonatal ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL; END $$;

-- Política de lectura (idempotente via DROP + CREATE)
DROP POLICY IF EXISTS rn_read  ON ece.reanimacion_neonatal;
DROP POLICY IF EXISTS rn_write ON ece.reanimacion_neonatal;
DROP POLICY IF EXISTS rn_update ON ece.reanimacion_neonatal;

CREATE POLICY rn_read ON ece.reanimacion_neonatal
  FOR SELECT
  USING (current_setting('app.current_org_id', true) IS NOT NULL);

CREATE POLICY rn_write ON ece.reanimacion_neonatal
  FOR INSERT
  WITH CHECK (current_setting('app.current_org_id', true) IS NOT NULL);

CREATE POLICY rn_update ON ece.reanimacion_neonatal
  FOR UPDATE
  USING (
    current_setting('app.current_org_id', true) IS NOT NULL
    AND cerrado_en IS NULL
  );

COMMENT ON TABLE ece.reanimacion_neonatal IS
  'Registro del protocolo NRP (AHA/AAP) por evento de reanimación neonatal. '
  'Los pasos son timestamped para análisis de latencia. Cat-E: acceso restringido. '
  'Estado: cerrado_en IS NULL = en_curso; IS NOT NULL = cerrado.';
