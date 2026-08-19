-- =====================================================================
-- 62a_ece_doc_helper.sql
-- Categoría D (drift schema.prisma <-> SQL evolutivo en ece.*) —
-- feat/db-portable, 2026-08-19.
--
-- Root cause: ece._doc(text), ece._estado(text, text) y ece._rol(text) —
-- helpers de lookup del motor de workflow ECE (resuelven id de
-- ece.tipo_documento / ece.flujo_estado / ece.rol a partir de sus códigos
-- NTEC) — se usaban desde 63_ece_08_seed.sql en adelante (también
-- 96_function_search_path_hardening.sql, 162_search_path_trigger_functions.sql)
-- pero NUNCA existía un CREATE FUNCTION para ninguna de las tres en
-- ningún archivo del corpus.
-- A diferencia de ece.current_establecimiento_id() / current_establecimiento_id_safe()
-- / set_ece_context() (creadas en 62_ece_07_rls.sql y
-- 65_ece_rls_hardening.sql), estas dos funciones solo existían en
-- producción — extraídas aquí vía pg_get_functiondef() por introspección
-- de solo lectura (mcp__.../execute_sql, sin escritura a prod).
--
-- Nota de numeración: se usa el sufijo "62a" (precedente 30a/30b) en vez
-- de un número >= 201 porque estas funciones deben existir ANTES de
-- 63_ece_08_seed.sql (primer consumidor) — un archivo con numeración
-- 201+ ordenaría *después* de 63 en sort -V y dejaría el seed roto igual.
-- Depende de: 60_ece_05_motor.sql (crea ece.tipo_documento y ece.flujo_estado).
-- =====================================================================

CREATE OR REPLACE FUNCTION ece._doc(p_codigo text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'ece', 'public', 'pg_catalog'
AS $function$ select id from ece.tipo_documento where codigo = p_codigo $function$;

CREATE OR REPLACE FUNCTION ece._estado(p_doc text, p_estado text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'ece', 'public', 'pg_catalog'
AS $function$
  select fe.id
    from ece.flujo_estado fe
    join ece.tipo_documento td on td.id = fe.tipo_documento_id
   where td.codigo = p_doc and fe.codigo = p_estado
$function$;

CREATE OR REPLACE FUNCTION ece._rol(p_codigo text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'ece', 'public', 'pg_catalog'
AS $function$ select id from ece.rol where codigo = p_codigo $function$;
