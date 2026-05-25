-- =============================================================================
-- 122_kpi_falls_rate.sql
-- JCI Standard: IPSG.6 / QPS Library of Measures #16
-- Tasa de caídas de pacientes por 1 000 días-cama (mensual)
-- US.JCI.5.17 | Sprint S3 | 2026-05-24
--
-- Modelo de datos relevante (columnas reales verificadas vía MCP 2026-05-24):
--   ece.fall_event
--     id, establecimiento_id, fecha_hora, lesion_resultante
--   ece.episodio_hospitalario
--     episodio_id, fecha_hora_orden_ingreso, fecha_hora_egreso  (sin org_id directo)
--   ece.episodio_atencion
--     id (= episodio_hospitalario.episodio_id), establecimiento_id
--
-- Estrategia días-cama:
--   Para cada mes M, un episodio contribuye días si:
--     fecha_hora_orden_ingreso < inicio(M+1)  AND  COALESCE(fecha_hora_egreso, NOW()) > inicio(M)
--   Días aportados = LEAST(egreso, inicio(M+1)) - GREATEST(ingreso, inicio(M))
--   Expresado en días fraccionarios con EXTRACT(EPOCH …) / 86400.
--
-- Refresh: CONCURRENTLY diario a las 03:00 vía pg_cron.
-- =============================================================================

-- ─── Materializada ───────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS analytics.kpi_falls_rate_monthly CASCADE;

CREATE MATERIALIZED VIEW analytics.kpi_falls_rate_monthly AS

WITH

-- 1. Meses con al menos un evento de caída registrado
meses AS (
  SELECT DISTINCT
    establecimiento_id,
    date_trunc('month', fecha_hora)::DATE AS period_month
  FROM ece.fall_event
),

-- 2. Días-cama por establecimiento × mes
--    Episodios hospitalizados que solapan con el mes
dias_cama AS (
  SELECT
    ea.establecimiento_id,
    m.period_month,
    GREATEST(
      SUM(
        EXTRACT(EPOCH FROM (
          LEAST(
            COALESCE(eh.fecha_hora_egreso, NOW()),
            (m.period_month + INTERVAL '1 month')
          )
          -
          GREATEST(
            eh.fecha_hora_orden_ingreso,
            m.period_month::TIMESTAMPTZ
          )
        )) / 86400.0
      ),
      0
    ) AS total_dias_cama
  FROM meses m
  JOIN ece.episodio_atencion    ea ON ea.establecimiento_id = m.establecimiento_id
  JOIN ece.episodio_hospitalario eh ON eh.episodio_id = ea.id
  WHERE
    -- El episodio se solapa con el mes
    eh.fecha_hora_orden_ingreso  < (m.period_month + INTERVAL '1 month')::TIMESTAMPTZ
    AND COALESCE(eh.fecha_hora_egreso, NOW()) > m.period_month::TIMESTAMPTZ
  GROUP BY ea.establecimiento_id, m.period_month
),

-- 3. Conteo de caídas por establecimiento × mes
caidas AS (
  SELECT
    establecimiento_id,
    date_trunc('month', fecha_hora)::DATE AS period_month,
    COUNT(DISTINCT id)                                                        AS total_caidas,
    COUNT(DISTINCT id) FILTER (
      WHERE lesion_resultante IN ('moderada', 'grave', 'muy_grave')
    )                                                                         AS caidas_con_lesion_significativa
  FROM ece.fall_event
  GROUP BY 1, 2
)

-- 4. Ensamble final con KPI
SELECT
  c.establecimiento_id,
  c.period_month,
  c.total_caidas,
  c.caidas_con_lesion_significativa,
  COALESCE(dc.total_dias_cama, 0)::NUMERIC(12, 2)                           AS dias_cama,
  ROUND(
    c.total_caidas * 1000.0 / NULLIF(COALESCE(dc.total_dias_cama, 0), 0),
    2
  )                                                                          AS tasa_caidas_por_1000_dias_cama,
  ROUND(
    c.caidas_con_lesion_significativa * 1000.0
      / NULLIF(COALESCE(dc.total_dias_cama, 0), 0),
    2
  )                                                                          AS tasa_lesion_significativa_por_1000_dias_cama,
  NOW()                                                                      AS calculado_en
FROM caidas c
LEFT JOIN dias_cama dc
  ON dc.establecimiento_id = c.establecimiento_id
  AND dc.period_month = c.period_month;

-- ─── Índice único para REFRESH CONCURRENTLY ───────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uix_kpi_falls_rate_monthly
  ON analytics.kpi_falls_rate_monthly (establecimiento_id, period_month);

-- Índice de soporte para filtros de dashboard (range de fechas)
CREATE INDEX IF NOT EXISTS idx_kpi_falls_rate_period
  ON analytics.kpi_falls_rate_monthly (period_month DESC);

COMMENT ON MATERIALIZED VIEW analytics.kpi_falls_rate_monthly IS
  'JCI IPSG.6 / QPS Library of Measures #16. '
  'Tasa de caídas por 1 000 días-cama, granularidad mensual por establecimiento. '
  'Columnas clave para dashboard QPS E-03: tasa_caidas_por_1000_dias_cama, '
  'tasa_lesion_significativa_por_1000_dias_cama. '
  'Refresh diario 03:00 (pg_cron job: kpi_falls_rate_refresh). '
  'US.JCI.5.17 | 2026-05-24.';

-- ─── pg_cron: refresh diario 03:00 ───────────────────────────────────────────
DO $$
DECLARE
  existing_job INT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'kpi_falls_rate_refresh';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
END
$$;

SELECT cron.schedule(
  'kpi_falls_rate_refresh',
  '0 3 * * *',
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.kpi_falls_rate_monthly; $$
);
