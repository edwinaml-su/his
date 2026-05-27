-- 58_ece_schema_grants.sql
-- Fix UAT/prod (descubierto 2026-05-27): el rol "authenticated" de Supabase
-- carecía de USAGE en el schema "ece". `withWorkflowContext` demota el rol
-- al ejecutar queries del motor ECE (hojas, indicaciones, actos quirúrgicos
-- vía $queryRaw) y todas fallaban con:
--
--   ERROR 42501: permission denied for schema ece
--
-- Las tablas ya tenían RLS habilitado + policies (sql/61–67 del bloque ECE),
-- pero RLS solo se evalúa si el rol puede primero "ver" el schema (USAGE).
-- Sin USAGE el motor de PG corta antes de tocar las policies.
--
-- Este archivo es 100% idempotente — no falla si ya está aplicado.

-- 1) Acceso al schema (solo authenticated + service_role; nunca anon).
GRANT USAGE ON SCHEMA ece TO authenticated, service_role;

-- 2) DML estándar sobre todas las tablas existentes del schema.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ece TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ece TO service_role;

-- 3) Secuencias (UUID por DEFAULT y nextval explícitos).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ece TO authenticated, service_role;

-- 4) Funciones del motor (fn_assert_dependencias_firmadas, fn_depende_de_efectivo,
--    triggers BEFORE INSERT, etc.).
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ece TO authenticated, service_role;

-- 5) Default privileges → cualquier tabla/secuencia/función creada en este
--    schema POR EL ROL POSTGRES heredará estos grants. Evita regresión la
--    próxima vez que añadamos un módulo NTEC.
ALTER DEFAULT PRIVILEGES IN SCHEMA ece
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ece
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ece
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ece
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
