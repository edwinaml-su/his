-- =============================================================================
-- HIS SQL 44 — Smoke tests post-aplicación.
--
-- Cómo correr (SQL Editor del Supabase Dashboard, role postgres):
--   1. Aplicar SQL 44.
--   2. Pegar este archivo y ejecutar; cada bloque debe devolver el valor esperado.
--   3. Si algún bloque falla, ver troubleshooting en
--      docs/blueprints/beta15_poller_activation.md §Verificación.
-- =============================================================================

-- Smoke 1 — la función existe en schema notifications.
-- Esperado: 1 fila con proname = 'process_outbox_batch'.
SELECT n.nspname AS schema, p.proname AS function
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'notifications'
   AND p.proname = 'process_outbox_batch';

-- Smoke 2 — el cron job está scheduled cada minuto y activo.
-- Esperado: 1 fila, schedule='*/1 * * * *', active=true.
SELECT jobname, schedule, active
  FROM cron.job
 WHERE jobname = 'notifications-poll-outbox';

-- Smoke 3 — columnas operacionales añadidas a DomainEvent.
-- Esperado: 3 filas (lastAttemptAt, lastNetRequestId, lastError).
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'DomainEvent'
   AND column_name IN ('lastAttemptAt', 'lastNetRequestId', 'lastError')
 ORDER BY column_name;

-- Smoke 4 — GUCs configurados (post-runbook).
-- Esperado: 2 filas (app.notifications_dispatch_url, app.service_role_key).
-- Si devuelve 0 filas, ejecutar runbook §Configurar GUCs.
SELECT name, CASE WHEN length(setting) > 0 THEN '<set>' ELSE '<empty>' END AS state
  FROM pg_settings
 WHERE name IN ('app.notifications_dispatch_url', 'app.service_role_key');

-- Smoke 5 — extensiones instaladas.
-- Esperado: 2 filas (pg_cron, pg_net) con installed_version IS NOT NULL.
SELECT extname, extversion
  FROM pg_extension
 WHERE extname IN ('pg_cron', 'pg_net');

-- Smoke 6 — permisos: service_role tiene EXECUTE; authenticated NO.
-- Esperado: 1 fila con grantee='service_role', privilege_type='EXECUTE'.
-- Y 0 filas si filtras por grantee='authenticated'.
SELECT grantee, privilege_type
  FROM information_schema.routine_privileges
 WHERE specific_schema = 'notifications'
   AND routine_name    = 'process_outbox_batch'
 ORDER BY grantee;

-- Smoke 7 — invocación manual (dry run, batch p_limit=0 para no disparar HTTPs).
-- Esperado: retorna 0 (no eventos seleccionados con LIMIT 0).
SELECT notifications.process_outbox_batch(0) AS dispatched;

-- Smoke 8 — métrica dead-letter (en steady state debería ser 0).
-- Esperado: count = 0 (o número conocido si has tenido fallos).
SELECT count(*) AS dead_letter_count
  FROM public."DomainEvent"
 WHERE attempts >= 6 AND "publishedAt" IS NULL;
