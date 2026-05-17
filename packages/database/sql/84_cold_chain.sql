-- =============================================================================
-- HIS SQL 84 — Cold Chain Monitoring (placeholder IoT, F2-S15 real sensor)
--
-- Tablas en schema ece:
--   ece.cold_chain_config_equipo  — rangos aceptables por equipo (PK = equipment_id)
--   ece.cold_chain_lectura        — lecturas de temperatura/humedad (manual o iot_sensor)
--   ece.cold_chain_alerta         — alertas generadas cuando lectura fuera de rango
--
-- RLS Cat-E: authenticated puede SELECT según organizationId via join a
--   public."BiomedicalEquipment"; service_role bypasea.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DO $$ guards.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabla de configuración de rangos por equipo
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.cold_chain_config_equipo (
  equipment_id       UUID        NOT NULL
                     REFERENCES public."BiomedicalEquipment"(id) ON DELETE CASCADE,
  temp_min_c         NUMERIC(6,2) NOT NULL,
  temp_max_c         NUMERIC(6,2) NOT NULL,
  humedad_min_pct    NUMERIC(5,2),
  humedad_max_pct    NUMERIC(5,2),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por    UUID,

  CONSTRAINT cold_chain_config_pk          PRIMARY KEY (equipment_id),
  CONSTRAINT cold_chain_config_temp_check  CHECK (temp_min_c < temp_max_c),
  CONSTRAINT cold_chain_config_hum_check   CHECK (
    humedad_min_pct IS NULL
    OR humedad_max_pct IS NULL
    OR humedad_min_pct < humedad_max_pct
  )
);

COMMENT ON TABLE ece.cold_chain_config_equipo IS
  'Rangos aceptables de temperatura y humedad por equipo (referenciados desde cold_chain_lectura).';

-- ---------------------------------------------------------------------------
-- 2. Tabla de lecturas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.cold_chain_lectura (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  equipment_id   UUID        NOT NULL
                 REFERENCES public."BiomedicalEquipment"(id) ON DELETE RESTRICT,
  temperatura_c  NUMERIC(6,2) NOT NULL,
  humedad_pct    NUMERIC(5,2),
  registrado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  dentro_rango   BOOLEAN     NOT NULL DEFAULT true,
  fuente         TEXT        NOT NULL DEFAULT 'manual'
                 CHECK (fuente IN ('manual', 'iot_sensor')),
  registrado_por UUID,

  CONSTRAINT cold_chain_lectura_pk PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS ix_cold_chain_lectura_equipment_ts
  ON ece.cold_chain_lectura (equipment_id, registrado_en DESC);

COMMENT ON TABLE ece.cold_chain_lectura IS
  'Lecturas de temperatura/humedad. fuente=iot_sensor para integraciones futuras (F2-S15).';

-- ---------------------------------------------------------------------------
-- 3. Tabla de alertas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.cold_chain_alerta (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  lectura_id     UUID        NOT NULL
                 REFERENCES ece.cold_chain_lectura(id) ON DELETE CASCADE,
  equipment_id   UUID        NOT NULL
                 REFERENCES public."BiomedicalEquipment"(id) ON DELETE RESTRICT,
  severidad      TEXT        NOT NULL CHECK (severidad IN ('WARNING', 'CRITICAL')),
  mensaje        TEXT        NOT NULL,
  atendida_por   UUID,
  atendida_en    TIMESTAMPTZ,
  creada_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cold_chain_alerta_pk PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS ix_cold_chain_alerta_equipment_no_atendida
  ON ece.cold_chain_alerta (equipment_id, creada_en DESC)
  WHERE atendida_en IS NULL;

COMMENT ON TABLE ece.cold_chain_alerta IS
  'Alertas generadas automáticamente cuando una lectura está fuera del rango configurado.';

-- ---------------------------------------------------------------------------
-- 4. RLS Cat-E — acceso tenant via join a BiomedicalEquipment
-- ---------------------------------------------------------------------------

-- cold_chain_config_equipo
ALTER TABLE ece.cold_chain_config_equipo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cold_chain_config_select ON ece.cold_chain_config_equipo;
CREATE POLICY cold_chain_config_select ON ece.cold_chain_config_equipo
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."BiomedicalEquipment" be
       WHERE be.id = equipment_id
         AND be."organizationId"::text = current_setting('app.current_org_id', true)
    )
  );

DROP POLICY IF EXISTS cold_chain_config_write ON ece.cold_chain_config_equipo;
CREATE POLICY cold_chain_config_write ON ece.cold_chain_config_equipo
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."BiomedicalEquipment" be
       WHERE be.id = equipment_id
         AND be."organizationId"::text = current_setting('app.current_org_id', true)
    )
  );

-- cold_chain_lectura
ALTER TABLE ece.cold_chain_lectura ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cold_chain_lectura_select ON ece.cold_chain_lectura;
CREATE POLICY cold_chain_lectura_select ON ece.cold_chain_lectura
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."BiomedicalEquipment" be
       WHERE be.id = equipment_id
         AND be."organizationId"::text = current_setting('app.current_org_id', true)
    )
  );

DROP POLICY IF EXISTS cold_chain_lectura_insert ON ece.cold_chain_lectura;
CREATE POLICY cold_chain_lectura_insert ON ece.cold_chain_lectura
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public."BiomedicalEquipment" be
       WHERE be.id = equipment_id
         AND be."organizationId"::text = current_setting('app.current_org_id', true)
    )
  );

-- cold_chain_alerta
ALTER TABLE ece.cold_chain_alerta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cold_chain_alerta_select ON ece.cold_chain_alerta;
CREATE POLICY cold_chain_alerta_select ON ece.cold_chain_alerta
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."BiomedicalEquipment" be
       WHERE be.id = equipment_id
         AND be."organizationId"::text = current_setting('app.current_org_id', true)
    )
  );

DROP POLICY IF EXISTS cold_chain_alerta_update ON ece.cold_chain_alerta;
CREATE POLICY cold_chain_alerta_update ON ece.cold_chain_alerta
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."BiomedicalEquipment" be
       WHERE be.id = equipment_id
         AND be."organizationId"::text = current_setting('app.current_org_id', true)
    )
  );
