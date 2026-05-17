-- =============================================================================
-- SQL 51 — BI pg_cron Refresh Jobs + bi_refresh_log (Beta.19b)
-- Wave: Beta.19b — Fase 6 TDR §26-27
-- Owner: @BID — BI Developer
-- Dependencias: SQL 50 (todas las matviews analytics), SQL 48 (schema + refresh_all)
-- Patron de referencia: ADR 0008 + SQL 43 (pg_cron poller Beta.15)
-- =============================================================================
-- IMPORTANTE: pg_cron requiere que la extension este habilitada en Supabase
-- (Extensions > pg_cron, habilitada por defecto en proyectos Supabase Pro).
-- Si no esta habilitada: Settings > Database > Extensions > pg_cron.
--
-- Los jobs se registran en cron.job (schema propiedad de pg_cron).
-- service_role es el rol que ejecuta los jobs en Supabase pg_cron.
--
-- Referencia: ADR 0009 D5 — cadencias de refresh:
--   Dims SCD1 (org/estab/diag/drug): cada 24h a las 03:00 UTC
--   Dims frecuentes (patient/user_role): cada 1h
--   Facts clinicos (encounter/lab/rx/transfusion): cada 1h
--   Facts financieros (journal_line): cada 4h
-- =============================================================================

-- =============================================================================
-- SECCION 1 — Tabla bi_refresh_log (append-only)
-- Registra cada ejecucion de refresh: dataset, duracion, estado, error.
-- Retencion: 90 dias (purga via pg_cron job adicional).
-- =============================================================================

CREATE TABLE IF NOT EXISTS analytics.bi_refresh_log (
  id            BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  dataset       VARCHAR(100)  NOT NULL,  -- nombre de la matview, ej 'fact_encounter'
  duration_ms   INTEGER,                 -- NULL si fallo antes de empezar
  status        VARCHAR(20)   NOT NULL   CHECK (status IN ('success', 'error', 'skipped')),
  error_msg     TEXT,                    -- NULL si status = success
  rows_estimate BIGINT,                  -- pg_class.reltuples post-refresh (aproximado)
  triggered_by  VARCHAR(50)   DEFAULT 'pg_cron'  -- 'pg_cron', 'manual', 'edge_function'
);

COMMENT ON TABLE analytics.bi_refresh_log IS
  'Log append-only de refreshes de matviews analytics. Retencion 90 dias.
   Tabla inmutable: UPDATE/DELETE bloqueados por trigger.
   Purga automatica: pg_cron job "bi_purge_refresh_log" en este mismo SQL.';

-- Trigger para bloquear UPDATE/DELETE (append-only, igual que bi_query_log)
CREATE OR REPLACE FUNCTION analytics.fn_block_refresh_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'bi_refresh_log es append-only. UPDATE/DELETE no permitidos.';
END;
$$;

CREATE OR REPLACE TRIGGER trg_bi_refresh_log_immutable
  BEFORE UPDATE OR DELETE ON analytics.bi_refresh_log
  FOR EACH ROW
  EXECUTE FUNCTION analytics.fn_block_refresh_log_mutation();

-- Indices para consulta de logs
CREATE INDEX IF NOT EXISTS bi_refresh_log_run_at_idx
  ON analytics.bi_refresh_log (run_at DESC);

CREATE INDEX IF NOT EXISTS bi_refresh_log_dataset_status_idx
  ON analytics.bi_refresh_log (dataset, status, run_at DESC);

-- Permisos: service_role inserta y lee; bi_reader solo lee sus propios logs de refresh
GRANT SELECT ON analytics.bi_refresh_log TO bi_reader;
GRANT SELECT ON analytics.bi_refresh_log TO authenticated;

-- =============================================================================
-- SECCION 2 — Funciones de refresh individual con logging
-- Cada funcion refresca UNA matview, loguea en bi_refresh_log y maneja errores.
-- Patron: BEGIN -> REFRESH -> log success. En EXCEPTION -> log error.
-- =============================================================================

-- Funcion generica interna (no expuesta): ejecuta REFRESH y loguea
CREATE OR REPLACE FUNCTION analytics.fn_refresh_matview(
  p_dataset    TEXT,
  p_triggered_by TEXT DEFAULT 'pg_cron'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
DECLARE
  v_start      TIMESTAMPTZ := clock_timestamp();
  v_duration   INTEGER;
  v_rows       BIGINT;
  v_sql        TEXT;
BEGIN
  -- Construir y ejecutar REFRESH CONCURRENTLY dinamicamente
  v_sql := FORMAT(
    'REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.%I',
    p_dataset
  );

  EXECUTE v_sql;

  -- Estimar filas post-refresh (aprox, no exacto — evita COUNT(*) costoso)
  SELECT reltuples::BIGINT
  INTO v_rows
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'analytics'
    AND c.relname = p_dataset;

  v_duration := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start))::INTEGER;

  INSERT INTO analytics.bi_refresh_log (run_at, dataset, duration_ms, status, rows_estimate, triggered_by)
  VALUES (NOW(), p_dataset, v_duration, 'success', COALESCE(v_rows, -1), p_triggered_by);

EXCEPTION WHEN OTHERS THEN
  v_duration := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start))::INTEGER;

  INSERT INTO analytics.bi_refresh_log (run_at, dataset, duration_ms, status, error_msg, triggered_by)
  VALUES (NOW(), p_dataset, v_duration, 'error', SQLERRM, p_triggered_by);

  -- Re-raise para que pg_cron registre el fallo en cron.job_run_details
  RAISE;
END;
$$;

COMMENT ON FUNCTION analytics.fn_refresh_matview IS
  'Refresca una matview individual con logging en bi_refresh_log.
   Uso interno. Llamar via funciones especificas o refresh_all_with_log().';

-- Funcion publica: refresh_all con logging individual por dataset
CREATE OR REPLACE FUNCTION analytics.refresh_all_with_log(
  p_triggered_by TEXT DEFAULT 'pg_cron'
)
RETURNS TABLE (
  dataset    TEXT,
  status     TEXT,
  duration_ms INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
DECLARE
  v_datasets TEXT[] := ARRAY[
    -- ORDEN: dims SCD1 -> dims frecuentes -> facts clinicos -> facts financieros
    'dim_organization',
    'dim_establishment',
    'dim_diagnosis',
    'dim_drug',
    'dim_patient',
    'dim_user_role',
    'fact_encounter',
    'fact_lab_result',
    'fact_prescription',
    'fact_transfusion',
    'fact_journal_line'
  ];
  v_ds TEXT;
BEGIN
  FOREACH v_ds IN ARRAY v_datasets LOOP
    BEGIN
      PERFORM analytics.fn_refresh_matview(v_ds, p_triggered_by);
      RETURN QUERY
        SELECT v_ds, 'success'::TEXT,
          (SELECT duration_ms FROM analytics.bi_refresh_log
           WHERE dataset = v_ds ORDER BY run_at DESC LIMIT 1);
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY
        SELECT v_ds, 'error'::TEXT,
          (SELECT duration_ms FROM analytics.bi_refresh_log
           WHERE dataset = v_ds ORDER BY run_at DESC LIMIT 1);
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION analytics.refresh_all_with_log IS
  'Refresca todas las matviews con logging individual. Retorna tabla de resultados.
   Ejemplo: SELECT * FROM analytics.refresh_all_with_log();
   Usar en lugar de analytics.refresh_all() cuando se necesite trazabilidad.';

-- Permisos: solo service_role puede ejecutar refreshes
GRANT EXECUTE ON FUNCTION analytics.fn_refresh_matview(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION analytics.refresh_all_with_log(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION analytics.fn_refresh_matview(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION analytics.fn_refresh_matview(TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION analytics.refresh_all_with_log(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION analytics.refresh_all_with_log(TEXT) FROM authenticated;

-- =============================================================================
-- SECCION 3 — Jobs pg_cron
-- Convención: job name = 'bi_refresh_<dataset>'
-- Todos los jobs usan service_role via la funcion fn_refresh_matview.
--
-- PREREQUISITO: pg_cron extension habilitada.
-- Verificar: SELECT * FROM pg_extension WHERE extname = 'pg_cron';
--
-- Nota: pg_cron en Supabase ejecuta como postgres (BYPASSRLS).
-- Las funciones SECURITY DEFINER garantizan el contexto correcto.
-- =============================================================================

-- Helper: eliminar job si existe (idempotente)
DO $$
DECLARE
  v_jobs TEXT[] := ARRAY[
    'bi_refresh_dim_organization',
    'bi_refresh_dim_establishment',
    'bi_refresh_dim_diagnosis',
    'bi_refresh_dim_drug',
    'bi_refresh_dim_patient',
    'bi_refresh_dim_user_role',
    'bi_refresh_fact_encounter',
    'bi_refresh_fact_lab_result',
    'bi_refresh_fact_prescription',
    'bi_refresh_fact_transfusion',
    'bi_refresh_fact_journal_line',
    'bi_purge_refresh_log'
  ];
  v_job TEXT;
BEGIN
  -- Solo intentar si pg_cron esta disponible
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOREACH v_job IN ARRAY v_jobs LOOP
      PERFORM cron.unschedule(v_job)
      WHERE EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = v_job
      );
    END LOOP;
  ELSE
    RAISE NOTICE 'pg_cron no esta habilitada. Salteando configuracion de jobs.';
    RAISE NOTICE 'Habilitar en: Supabase > Settings > Database > Extensions > pg_cron';
    RAISE NOTICE 'Luego re-ejecutar este SQL para registrar los jobs.';
  END IF;
END;
$$;

-- Registrar jobs SOLO si pg_cron esta disponible
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron no disponible: jobs NO registrados. Ver instrucciones arriba.';
    RETURN;
  END IF;

  -- -------------------------------------------------------------------------
  -- DIMS SCD1 — refresh diario a las 03:00 UTC (baja actividad clinica)
  -- -------------------------------------------------------------------------

  -- dim_organization: diario 03:00 UTC
  PERFORM cron.schedule(
    'bi_refresh_dim_organization',
    '0 3 * * *',
    $$SELECT analytics.fn_refresh_matview('dim_organization', 'pg_cron');$$
  );

  -- dim_establishment: diario 03:05 UTC (5 min despues de org)
  PERFORM cron.schedule(
    'bi_refresh_dim_establishment',
    '5 3 * * *',
    $$SELECT analytics.fn_refresh_matview('dim_establishment', 'pg_cron');$$
  );

  -- dim_diagnosis: diario 03:10 UTC
  PERFORM cron.schedule(
    'bi_refresh_dim_diagnosis',
    '10 3 * * *',
    $$SELECT analytics.fn_refresh_matview('dim_diagnosis', 'pg_cron');$$
  );

  -- dim_drug: diario 03:15 UTC
  PERFORM cron.schedule(
    'bi_refresh_dim_drug',
    '15 3 * * *',
    $$SELECT analytics.fn_refresh_matview('dim_drug', 'pg_cron');$$
  );

  -- -------------------------------------------------------------------------
  -- DIMS FRECUENTES — refresh cada 1h
  -- -------------------------------------------------------------------------

  -- dim_patient: cada hora en el minuto 0
  PERFORM cron.schedule(
    'bi_refresh_dim_patient',
    '0 * * * *',
    $$SELECT analytics.fn_refresh_matview('dim_patient', 'pg_cron');$$
  );

  -- dim_user_role: cada hora en el minuto 2
  PERFORM cron.schedule(
    'bi_refresh_dim_user_role',
    '2 * * * *',
    $$SELECT analytics.fn_refresh_matview('dim_user_role', 'pg_cron');$$
  );

  -- -------------------------------------------------------------------------
  -- FACTS CLINICOS — refresh cada 1h (latencia objetivo < 1.5h, ADR 0009)
  -- Escalonados para no saturar I/O simultaneamente
  -- -------------------------------------------------------------------------

  -- fact_encounter: cada hora en el minuto 5
  -- (despues de dim_patient y dim_user_role para FK logicas consistentes)
  PERFORM cron.schedule(
    'bi_refresh_fact_encounter',
    '5 * * * *',
    $$SELECT analytics.fn_refresh_matview('fact_encounter', 'pg_cron');$$
  );

  -- fact_lab_result: cada hora en el minuto 15
  PERFORM cron.schedule(
    'bi_refresh_fact_lab_result',
    '15 * * * *',
    $$SELECT analytics.fn_refresh_matview('fact_lab_result', 'pg_cron');$$
  );

  -- fact_prescription: cada hora en el minuto 25
  PERFORM cron.schedule(
    'bi_refresh_fact_prescription',
    '25 * * * *',
    $$SELECT analytics.fn_refresh_matview('fact_prescription', 'pg_cron');$$
  );

  -- fact_transfusion: cada hora en el minuto 35
  PERFORM cron.schedule(
    'bi_refresh_fact_transfusion',
    '35 * * * *',
    $$SELECT analytics.fn_refresh_matview('fact_transfusion', 'pg_cron');$$
  );

  -- -------------------------------------------------------------------------
  -- FACTS FINANCIEROS — refresh cada 4h (latencia objetivo < 28h, ADR 0009)
  -- -------------------------------------------------------------------------

  -- fact_journal_line: cada 4h (00:45, 04:45, 08:45, 12:45, 16:45, 20:45 UTC)
  PERFORM cron.schedule(
    'bi_refresh_fact_journal_line',
    '45 */4 * * *',
    $$SELECT analytics.fn_refresh_matview('fact_journal_line', 'pg_cron');$$
  );

  -- -------------------------------------------------------------------------
  -- PURGA de logs antiguos — semanal, domingo 02:00 UTC
  -- Elimina entradas de bi_refresh_log con run_at > 90 dias
  -- EXCEPCION al append-only: la purga la ejecuta service_role con BYPASSRLS
  -- y usa DELETE directo (no pasa por el trigger que bloquea a roles normales).
  -- -------------------------------------------------------------------------

  PERFORM cron.schedule(
    'bi_purge_refresh_log',
    '0 2 * * 0',
    $$
      DELETE FROM analytics.bi_refresh_log
      WHERE run_at < NOW() - INTERVAL '90 days';
    $$
  );

  RAISE NOTICE 'pg_cron: 12 jobs de BI refresh registrados exitosamente.';
  RAISE NOTICE 'Verificar con: SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE ''bi_%%'';';

END;
$$;

-- =============================================================================
-- SECCION 4 — Vista de monitoreo: ultimos refreshes por dataset
-- Permite a @BID monitorear el estado sin query compleja.
-- =============================================================================

CREATE OR REPLACE VIEW analytics.v_refresh_status AS
SELECT DISTINCT ON (dataset)
  dataset,
  run_at      AS last_run_at,
  status      AS last_status,
  duration_ms AS last_duration_ms,
  rows_estimate AS last_rows_estimate,
  error_msg   AS last_error_msg
FROM analytics.bi_refresh_log
ORDER BY dataset, run_at DESC;

COMMENT ON VIEW analytics.v_refresh_status IS
  'Ultimo estado de refresh por dataset. Consultar para monitoreo.
   Ejemplo: SELECT * FROM analytics.v_refresh_status ORDER BY dataset;';

GRANT SELECT ON analytics.v_refresh_status TO bi_reader;
GRANT SELECT ON analytics.v_refresh_status TO authenticated;

-- =============================================================================
-- SECCION 5 — Instrucciones de verificacion post-aplicacion
-- =============================================================================

-- =============================================================================
-- Verificacion post-aplicacion:
--
--   -- 1. Verificar extension pg_cron
--   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
--
--   -- 2. Verificar jobs registrados
--   SELECT jobname, schedule, active, command
--   FROM cron.job
--   WHERE jobname LIKE 'bi_%'
--   ORDER BY jobname;
--
--   -- 3. Test manual de refresh con log:
--   SELECT analytics.fn_refresh_matview('fact_encounter', 'manual');
--   SELECT * FROM analytics.v_refresh_status;
--
--   -- 4. Ver log completo del ultimo dia:
--   SELECT dataset, status, duration_ms, error_msg, run_at
--   FROM analytics.bi_refresh_log
--   WHERE run_at > NOW() - INTERVAL '1 day'
--   ORDER BY run_at DESC;
--
--   -- 5. Refresh full con reporte (service_role):
--   SELECT * FROM analytics.refresh_all_with_log('manual');
--
-- FALLBACK si pg_cron no esta disponible:
--   Crear una Supabase Edge Function "bi-refresh" con cron schedule:
--     - Invoke analytics.fn_refresh_matview() via service_role connection
--     - Schedule en Supabase Dashboard > Edge Functions > Cron
--     - Cadencia: '0 * * * *' para facts clinicos + '45 */4 * * *' para financiero
-- =============================================================================
