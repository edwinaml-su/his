-- =====================================================================
-- 62b_ece_context_helpers.sql
-- Categoría D (drift schema.prisma <-> SQL evolutivo en ece.*) —
-- feat/db-portable, segunda pasada @DBA, 2026-08-19.
--
-- Root cause: ece.current_establecimiento_id() y ece.set_ece_context(uuid,
-- uuid) SÍ tienen su `CREATE OR REPLACE FUNCTION` en el corpus — ambas
-- viven dentro de 62_ece_07_rls.sql (líneas 21 y 50 de ese archivo) — pero
-- ese archivo falla en una reconstrucción desde cero por una razón NO
-- relacionada con estas dos funciones: `documento_instancia` no tiene
-- columna `estado` en schema.prisma (el nombre real en producción es
-- `estado_registro` — confirmado por introspección, ver hallazgo colateral
-- más abajo). El runner aplica cada archivo como una única sentencia
-- multi-statement sin BEGIN explícito → Postgres la trata como una
-- transacción implícita → el error tardío en 62_ece_07_rls.sql hace
-- ROLLBACK de TODO el archivo, incluidas las dos `CREATE FUNCTION` de las
-- primeras líneas. Por eso los consumidores posteriores (102, 124, 125,
-- 155, 162) ven "function does not exist" pese a que el archivo que
-- "debería" haberlas creado sí las declara.
--
-- Nota: ece.current_establecimiento_id_safe() (65_ece_rls_hardening.sql)
-- NO tiene este problema — ese archivo aplica limpio en la reconstrucción
-- (falla distinta y no relacionada en otros 76 archivos, no en 65) — por
-- eso no se repite aquí.
--
-- Extraídas aquí vía pg_get_functiondef() por introspección de SOLO
-- LECTURA contra prod (mcp__.../execute_sql, ejacvsgbewcerxtjtwto, sin
-- escritura) — son idénticas en cuerpo a las de 62_ece_07_rls.sql; el
-- `CREATE OR REPLACE FUNCTION` de este archivo y el de 62 son
-- estrictamente redundantes cuando 62 SÍ logra aplicar completo (ej. en
-- Supabase real, donde documento_instancia.estado_registro no le hace
-- fallar porque prod usa el nombre correcto en sus propios objetos) — no
-- se toca 62_ece_07_rls.sql para no reescribir un archivo ya aplicado en
-- prod (disciplina forward-only del corpus).
--
-- Nota de numeración: sufijo "62b" (precedente 62a, mismo día) para que
-- exista antes de sus consumidores reales — el primero en orden canónico
-- es 102_tipo_documento_establecimiento.sql (current_establecimiento_id)
-- y 155_fix_security_definer_search_path.sql (set_ece_context). `sort -V`
-- ordena "62a" y "62b" ANTES que "62" (verificado) — no hay problema: ninguna
-- de las dos funciones depende de que 62_ece_07_rls.sql haya corrido antes
-- (no referencian tablas nuevas, solo GUCs vía current_setting/set_config).
-- Depende únicamente de que exista el schema `ece` (creado en Fase 1 por
-- `prisma db push`).
--
-- Hallazgo colateral (fuera de alcance de este archivo, reportado aparte):
-- 62_ece_07_rls.sql y 95_f2_s15_d_audit_rbac.sql asumen una columna
-- `estado`/`auth_user_id` en ece.documento_instancia que NO existe ni en
-- schema.prisma ni en producción (el nombre real es `estado_registro` y
-- `creado_por` respectivamente, confirmado por introspección). No es un
-- caso de "falta sincronizar Prisma" — es un bug de contenido en esos dos
-- archivos, igual de real contra Supabase que contra un Postgres portable.
-- =====================================================================

CREATE OR REPLACE FUNCTION ece.current_establecimiento_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'ece', 'public', 'pg_catalog'
AS $function$
  SELECT NULLIF(current_setting('app.ece_establecimiento_id', true), '')::uuid;
$function$;

CREATE OR REPLACE FUNCTION ece.set_ece_context(p_personal_id uuid, p_establecimiento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'ece', 'public', 'pg_catalog'
AS $function$
BEGIN
  PERFORM set_config('app.ece_personal_id', coalesce(p_personal_id::text, ''), true);
  PERFORM set_config('app.ece_establecimiento_id', coalesce(p_establecimiento_id::text, ''), true);
END;
$function$;
