-- =============================================================================
-- SQL 48 — BI Analytics Schema Foundation (Beta.19a)
-- Wave: Beta.19a — Fase 6 TDR §26-27
-- Owner: @DA — Data Architect BI
-- Dependencias: ADR 0009, public schema (tablas OLTP 4NF)
-- Aplicar en: Supabase SQL Editor / mcp__supabase__apply_migration
-- Siguiente: SQL 49 (RLS), Beta.19b (fact tables + dbt Silver layer)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECCION 1 — Schema y permisos base
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS analytics;

-- Revocar acceso por defecto al schema
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
REVOKE ALL ON SCHEMA analytics FROM anon;

-- Crear rol bi_reader si no existe
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_reader') THEN
    CREATE ROLE bi_reader NOLOGIN NOSUPERUSER NOREPLICATION;
  END IF;
END;
$$;

-- El rol bi_reader puede conectarse al schema y hacer SELECT
GRANT USAGE ON SCHEMA analytics TO bi_reader;

-- Timeouts para proteger el OLTP de queries analiticas largas
ALTER ROLE bi_reader SET statement_timeout = '30s';
ALTER ROLE bi_reader SET lock_timeout = '5s';
ALTER ROLE bi_reader SET work_mem = '64MB';

-- service_role y authenticated necesitan poder REFRESH las matviews
-- (el refresh lo ejecuta pg_cron con service_role)
GRANT USAGE ON SCHEMA analytics TO service_role;
GRANT USAGE ON SCHEMA analytics TO authenticated;

-- -----------------------------------------------------------------------------
-- SECCION 2 — dim_date (tabla estatica, no matview)
-- Grain: un dia del calendario, 2020-01-01 a 2040-12-31 (7306 filas)
-- SCD: no aplica (inmutable)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics.dim_date (
  date_sk            INTEGER      PRIMARY KEY,  -- YYYYMMDD, ej 20260516
  full_date          DATE         NOT NULL UNIQUE,
  year               SMALLINT     NOT NULL,
  quarter            SMALLINT     NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  month              SMALLINT     NOT NULL CHECK (month BETWEEN 1 AND 12),
  month_name_es      VARCHAR(20)  NOT NULL,
  week_of_year       SMALLINT     NOT NULL,
  day_of_week        SMALLINT     NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  day_name_es        VARCHAR(20)  NOT NULL,
  day_of_month       SMALLINT     NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  is_weekend         BOOLEAN      NOT NULL,
  is_sv_holiday      BOOLEAN      NOT NULL DEFAULT FALSE,
  fiscal_year_sv     SMALLINT     NOT NULL,
  fiscal_month_sv    SMALLINT     NOT NULL CHECK (fiscal_month_sv BETWEEN 1 AND 12)
);

COMMENT ON TABLE analytics.dim_date IS
  'Dimension de fecha estatica. Rango 2020-2040. No REFRESH periodico.';

-- Indice para joins por full_date desde fact tables
CREATE INDEX IF NOT EXISTS dim_date_full_date_idx ON analytics.dim_date (full_date);

-- Funcion para poblar dim_date (idempotente — INSERT OR IGNORE via ON CONFLICT)
CREATE OR REPLACE FUNCTION analytics.populate_dim_date(
  p_start DATE DEFAULT '2020-01-01',
  p_end   DATE DEFAULT '2040-12-31'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
DECLARE
  v_date DATE := p_start;
  v_count INTEGER := 0;
  -- Nombres de meses en espanol
  v_month_names TEXT[] := ARRAY[
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];
  -- Nombres de dias en espanol (ISO: 1=Lunes)
  v_day_names TEXT[] := ARRAY[
    'Lunes','Martes','Miercoles','Jueves','Viernes','Sabado','Domingo'
  ];
BEGIN
  WHILE v_date <= p_end LOOP
    INSERT INTO analytics.dim_date (
      date_sk, full_date, year, quarter, month, month_name_es,
      week_of_year, day_of_week, day_name_es, day_of_month,
      is_weekend, is_sv_holiday, fiscal_year_sv, fiscal_month_sv
    ) VALUES (
      -- date_sk = YYYYMMDD
      TO_CHAR(v_date, 'YYYYMMDD')::INTEGER,
      v_date,
      EXTRACT(YEAR  FROM v_date)::SMALLINT,
      EXTRACT(QUARTER FROM v_date)::SMALLINT,
      EXTRACT(MONTH FROM v_date)::SMALLINT,
      v_month_names[EXTRACT(MONTH FROM v_date)::INTEGER],
      EXTRACT(WEEK FROM v_date)::SMALLINT,
      EXTRACT(ISODOW FROM v_date)::SMALLINT,  -- 1=Lunes, 7=Domingo
      v_day_names[EXTRACT(ISODOW FROM v_date)::INTEGER],
      EXTRACT(DAY FROM v_date)::SMALLINT,
      EXTRACT(ISODOW FROM v_date) >= 6,       -- 6=Sabado, 7=Domingo
      FALSE,                                  -- is_sv_holiday: actualizar manualmente cada anio
      EXTRACT(YEAR FROM v_date)::SMALLINT,    -- fiscal_year_sv = calendar year (SV)
      EXTRACT(MONTH FROM v_date)::SMALLINT
    )
    ON CONFLICT (date_sk) DO NOTHING;

    v_count  := v_count + 1;
    v_date   := v_date + INTERVAL '1 day';
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION analytics.populate_dim_date IS
  'Pobla dim_date para el rango indicado. Idempotente. Invocar una vez al desplegar.
   Ejemplo: SELECT analytics.populate_dim_date();';

-- Ejecutar carga inicial en este mismo script
-- (idempotente: ON CONFLICT DO NOTHING si ya existe)
SELECT analytics.populate_dim_date();

-- Permisos de lectura en dim_date para bi_reader
GRANT SELECT ON analytics.dim_date TO bi_reader;
GRANT SELECT ON analytics.dim_date TO authenticated;

-- -----------------------------------------------------------------------------
-- SECCION 3 — dim_organization (materialized view sobre public."Organization")
-- Grain: una organizacion activa
-- SCD: Tipo 1 (overwrite en REFRESH CONCURRENTLY)
-- Refresh: cada 24 h via pg_cron (configurar en Beta.19b)
-- -----------------------------------------------------------------------------

-- Nota: "Organization" y "Establishment" en Prisma generan tablas con PascalCase
-- y columnas camelCase entre comillas. Respetamos esas comillas en los SELECTs.

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.dim_organization AS
SELECT
  -- Surrogate key: usamos ROW_NUMBER para orden determinista
  ROW_NUMBER() OVER (ORDER BY o."id") AS org_sk,
  o."id"                              AS organization_id,
  o."name"                            AS org_name,
  o."taxId"                           AS org_tax_id,
  c."isoAlpha3"                       AS country_code,
  o."functionalCurrency"              AS functional_currency,
  o."reportingCurrency"               AS reporting_currency,
  o."isActive"                        AS is_active,
  -- FK a dim_date para fecha de creacion
  COALESCE(
    TO_CHAR(o."createdAt"::DATE, 'YYYYMMDD')::INTEGER,
    20200101
  )                                   AS created_date_sk
FROM public."Organization" o
LEFT JOIN public."Country" c ON c."id" = o."countryId"
WITH DATA;

-- Unique index requerido para REFRESH CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS dim_organization_org_sk_idx
  ON analytics.dim_organization (org_sk);

CREATE INDEX IF NOT EXISTS dim_organization_org_id_idx
  ON analytics.dim_organization (organization_id);

COMMENT ON MATERIALIZED VIEW analytics.dim_organization IS
  'SCD Tipo 1. Refresh cada 24h. Fuente: public.Organization + Country.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_organization;';

GRANT SELECT ON analytics.dim_organization TO bi_reader;
GRANT SELECT ON analytics.dim_organization TO authenticated;

-- -----------------------------------------------------------------------------
-- SECCION 4 — dim_establishment (materialized view)
-- Grain: un establecimiento (sucursal/sede)
-- SCD: Tipo 1
-- Refresh: cada 24 h
-- -----------------------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.dim_establishment AS
SELECT
  ROW_NUMBER() OVER (ORDER BY e."id") AS estab_sk,
  e."id"                              AS establishment_id,
  e."organizationId"                  AS organization_id,
  e."name"                            AS estab_name,
  e."code"                            AS estab_code,
  c."isoAlpha3"                       AS country_code,
  e."type"                            AS estab_type,
  e."isActive"                        AS is_active
FROM public."Establishment" e
JOIN public."Organization" o ON o."id" = e."organizationId"
LEFT JOIN public."Country" c ON c."id" = o."countryId"
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS dim_establishment_sk_idx
  ON analytics.dim_establishment (estab_sk);

CREATE INDEX IF NOT EXISTS dim_establishment_estab_id_idx
  ON analytics.dim_establishment (establishment_id);

CREATE INDEX IF NOT EXISTS dim_establishment_org_id_idx
  ON analytics.dim_establishment (organization_id);

COMMENT ON MATERIALIZED VIEW analytics.dim_establishment IS
  'SCD Tipo 1. Refresh cada 24h. Fuente: public.Establishment.
   REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_establishment;';

GRANT SELECT ON analytics.dim_establishment TO bi_reader;
GRANT SELECT ON analytics.dim_establishment TO authenticated;

-- -----------------------------------------------------------------------------
-- SECCION 5 — Funcion analytics.refresh_all()
-- Placeholder que invocara todos los REFRESH en orden.
-- Beta.19b agrega dims + facts completos a esta funcion.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics.refresh_all()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
BEGIN
  -- Dims base (siempre primero — facts tienen FK logicas a estas)
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_organization;
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_establishment;

  -- Beta.19b: agregar aqui las restantes dims y facts
  -- REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_patient;
  -- REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_diagnosis;
  -- REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_drug;
  -- REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.dim_user_role;
  -- REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_encounter;
  -- REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_lab_result;
  -- REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_prescription;
  -- REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_transfusion;
  -- REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.fact_journal_line;

  RAISE NOTICE 'analytics.refresh_all() completado: % UTC', NOW();
END;
$$;

COMMENT ON FUNCTION analytics.refresh_all IS
  'Refresca todas las materialized views del schema analytics en orden correcto.
   Invocar desde pg_cron o Supabase Edge Function.
   Beta.19b: descomentar dims + facts adicionales.';

-- Solo service_role puede invocar refresh_all (no bi_reader)
GRANT EXECUTE ON FUNCTION analytics.refresh_all() TO service_role;
REVOKE EXECUTE ON FUNCTION analytics.refresh_all() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION analytics.refresh_all() FROM authenticated;

-- -----------------------------------------------------------------------------
-- SECCION 6 — Tabla de metadata del schema (catálogo de datasets)
-- Permite al catalogo de datos (DataHub/Amundsen futuro) introspeccionar el gold layer
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics.dataset_catalog (
  dataset_name      VARCHAR(100) NOT NULL PRIMARY KEY,
  layer             VARCHAR(10)  NOT NULL CHECK (layer IN ('bronze','silver','gold')),
  object_type       VARCHAR(20)  NOT NULL CHECK (object_type IN ('table','matview','view')),
  grain             TEXT         NOT NULL,
  scd_type          VARCHAR(10),
  refresh_cadence   VARCHAR(50),
  owner_role        VARCHAR(50),
  status            VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','skeleton','deprecated')),
  implemented_wave  VARCHAR(20),
  notes             TEXT,
  registered_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE analytics.dataset_catalog IS
  'Catalogo de datasets del gold layer. Fuente de verdad para gobernanza y DataHub.';

INSERT INTO analytics.dataset_catalog
  (dataset_name, layer, object_type, grain, scd_type, refresh_cadence, owner_role, status, implemented_wave)
VALUES
  ('dim_date',           'gold', 'table',   'Un dia del calendario',                              'none',    'anual (estatico)',  '@DA',  'active',   'beta19a'),
  ('dim_organization',   'gold', 'matview', 'Una organizacion',                                   'type1',   'cada 24h',          '@DA',  'active',   'beta19a'),
  ('dim_establishment',  'gold', 'matview', 'Un establecimiento',                                 'type1',   'cada 24h',          '@DA',  'active',   'beta19a'),
  ('dim_patient',        'gold', 'matview', 'Version de datos demograficos de un paciente',       'type2',   'cada 1h',           '@BID', 'skeleton', 'beta19b'),
  ('dim_diagnosis',      'gold', 'matview', 'Un codigo diagnostico (CIE-10 / SNOMED)',            'type1',   'cada 24h',          '@BID', 'skeleton', 'beta19b'),
  ('dim_drug',           'gold', 'matview', 'Un producto farmaceutico',                           'type1',   'cada 24h',          '@BID', 'skeleton', 'beta19b'),
  ('dim_user_role',      'gold', 'matview', 'Un par usuario-rol activo por organizacion',         'type1',   'cada 1h',           '@BID', 'skeleton', 'beta19b'),
  ('fact_encounter',     'gold', 'matview', 'Un encuentro clinico',                               NULL,      'cada 1h',           '@BID', 'skeleton', 'beta19b'),
  ('fact_lab_result',    'gold', 'matview', 'Un resultado de laboratorio liberado',               NULL,      'cada 1h',           '@BID', 'skeleton', 'beta19b'),
  ('fact_prescription',  'gold', 'matview', 'Una linea de prescripcion dispensada',               NULL,      'cada 1h',           '@BID', 'skeleton', 'beta19b'),
  ('fact_transfusion',   'gold', 'matview', 'Una unidad de sangre transfundida',                  NULL,      'cada 1h',           '@BID', 'skeleton', 'beta19b'),
  ('fact_journal_line',  'gold', 'matview', 'Una linea de asiento contable en cualquier libro',  NULL,      'cada 4h',           '@BID', 'skeleton', 'beta19b')
ON CONFLICT (dataset_name) DO NOTHING;

GRANT SELECT ON analytics.dataset_catalog TO bi_reader;
GRANT SELECT ON analytics.dataset_catalog TO authenticated;

-- =============================================================================
-- Verificacion post-aplicacion:
--
--   SELECT * FROM analytics.dataset_catalog ORDER BY status, dataset_name;
--   SELECT COUNT(*) FROM analytics.dim_date;          -- debe dar 7306
--   SELECT * FROM analytics.dim_organization LIMIT 5;
--   SELECT * FROM analytics.dim_establishment LIMIT 5;
--   SELECT analytics.refresh_all();                   -- (como service_role)
--
-- =============================================================================
