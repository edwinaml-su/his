-- =====================================================================
-- 114a_crn_updated_at_helper.sql
-- Categoría A/D mixta (función real definida en un archivo que solo
-- falla por dependencia de plataforma) — feat/db-portable, segunda
-- pasada @DBA, 2026-08-19.
--
-- Root cause: ece.crn_set_updated_at() SÍ tiene su `CREATE OR REPLACE
-- FUNCTION` en el corpus (línea 61 de 114_critical_result_notification.sql),
-- pero ese archivo falla en una reconstrucción fuera de Supabase porque
-- referencia el schema `cron` (pg_cron, no disponible fuera de la imagen
-- de Supabase — categoría A, ver 114/119/120/122 en
-- docs/runbooks/db-reconstruccion-fuera-de-supabase.md §3.2, fuera del
-- alcance de esta tarea). El runner trata el archivo completo como una
-- transacción implícita → el fallo tardío hace ROLLBACK también de la
-- `CREATE FUNCTION` de la línea 61. El consumidor posterior
-- (162_search_path_trigger_functions.sql, `ALTER FUNCTION
-- ece.crn_set_updated_at() SET search_path`) ve "function does not exist"
-- pese a que 114 sí la declara.
--
-- Extraída aquí vía pg_get_functiondef() por introspección de SOLO LECTURA
-- contra prod (mcp__.../execute_sql, ejacvsgbewcerxtjtwto, sin escritura) —
-- idéntica en cuerpo a la de 114_critical_result_notification.sql (con el
-- SET search_path explícito que 162 ya le fijó en prod). No se toca
-- 114_critical_result_notification.sql — sigue siendo el archivo correcto
-- para un target que sí tenga pg_cron; este archivo es solo el fallback
-- para que la función trigger exista cuando pg_cron no está.
--
-- Nota de numeración: sufijo "114a" para que exista antes de su único
-- consumidor conocido (162). `sort -V` ordena "114a" antes que "114"
-- (verificado) — sin problema: es una trigger function genérica
-- (`NEW.updated_at = NOW(); RETURN NEW;`), no referencia
-- ece.critical_result_notification por nombre en su cuerpo, así que no
-- depende de que esa tabla exista todavía.
--
-- Nota importante (no resuelto aquí, reportado aparte): incluso con esta
-- función presente, 162_search_path_trigger_functions.sql SIGUE fallando
-- en la reconstrucción local — la siguiente `ALTER FUNCTION` de esa lista
-- (ece.current_personal_id(), definida en 62_ece_07_rls.sql) tiene el
-- mismo problema de rollback-por-archivo que current_establecimiento_id()
-- (ver 62b_ece_context_helpers.sql) pero por una función que NINGÚN
-- archivo de este sprint tenía en su alcance asignado. Ver reporte final.
-- =====================================================================

CREATE OR REPLACE FUNCTION ece.crn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'ece', 'public', 'pg_catalog'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
