-- =============================================================================
-- ⚠ APLICADO a prod (ejacvsgbewcerxtjtwto) el 2026-09-19 vía MCP — NO re-aplicar.
-- 261_r1_anon_dml_sweep.sql — R1 (revisión independiente 2026-09-19, P2-2):
-- barrido de DML de `anon` en tablas SlaConfig sembradas DESPUÉS de sql/152
-- (NO aplicado — requiere OK de Edwin).
--
-- Origen del gap: los default privileges del schema `public` en este
-- proyecto Supabase otorgan DML completo (INSERT/UPDATE/DELETE/TRUNCATE) a
-- `anon` sobre TABLAS NUEVAS automáticamente. sql/152 (BD-P0-1) cerró esto
-- explícitamente para 9 tablas PHI/credenciales existentes en ese momento —
-- pero es un REVOKE puntual, no una regla `ALTER DEFAULT PRIVILEGES` que
-- proteja tablas futuras. Toda tabla creada DESPUÉS de sql/152 hereda DML
-- de `anon` por default salvo que su propio SQL lo revoque explícito (como
-- sql/258 ahora hace para `SsoProviderConfig`, en el mismo commit que este
-- archivo).
--
-- Este archivo cierra el gap para 3 tablas ya en prod, sembradas después de
-- sql/152 y sin su propio REVOKE:
--   - LabSlaConfig      (sql/251, CC-0040 extensión — supervisión de laboratorio)
--   - ImagingSlaConfig  (sql/253, CC-0041 — imágenes v2)
--   - TrSlaConfig       (CC-0042, terapia respiratoria — verificado en prod;
--                        el SQL que la creó no está en este branch/worktree,
--                        de ahí el `to_regclass` condicional: no asumimos que
--                        exista, solo actuamos si existe)
--
-- Ninguna de las 3 le da acceso a `anon` por diseño de aplicación — el
-- acceso real es tenantProcedure/requireRole vía withTenantContext (rol
-- `authenticated`). El REVOKE es puro cierre de una puerta que nunca debió
-- estar abierta (defensa en profundidad, mismo espíritu que sql/152).
--
-- Mismo criterio EXACTO que sql/152: revoca INSERT/UPDATE/DELETE/TRUNCATE,
-- NO toca SELECT (ninguna de las 3 le otorgó SELECT a `anon` tampoco — nunca
-- hubo GRANT a `anon` en ninguna de ellas, así que el REVOKE de SELECT sería
-- redundante; se deja fuera para no fingir que hubo un GRANT de lectura que
-- nunca existió).
--
-- Idempotente: REVOKE es no-op si el grant no existe; `to_regclass` evita
-- error si la tabla no existe en el Postgres donde se aplique (lección
-- "77/227 SQL fallan en Postgres limpio").
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public."LabSlaConfig"') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."LabSlaConfig" FROM anon';
  END IF;

  IF to_regclass('public."ImagingSlaConfig"') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."ImagingSlaConfig" FROM anon';
  END IF;

  IF to_regclass('public."TrSlaConfig"') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."TrSlaConfig" FROM anon';
  END IF;
END;
$$;

-- =============================================================================
-- Verificación post-aplicación (mismo patrón que sql/152):
--
--   SELECT grantee, table_name, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE grantee = 'anon'
--     AND table_name IN ('LabSlaConfig', 'ImagingSlaConfig', 'TrSlaConfig')
--     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
--   -- → 0 filas
--
-- NOTA para @DBA/@Dev: este es un gap SISTÉMICO, no de estas 3 tablas
-- puntuales — cualquier tabla nueva en `public` hereda DML de `anon` salvo
-- REVOKE explícito en su propio SQL. Evaluar `ALTER DEFAULT PRIVILEGES IN
-- SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon`
-- como fix estructural (fuera de alcance de R1 — cambiaría el default para
-- TODA tabla futura, requiere su propia revisión y OK de Edwin).
-- =============================================================================
