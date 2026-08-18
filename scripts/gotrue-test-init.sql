-- Bootstrap mínimo que necesita el Postgres efímero de docker-compose.test.yml
-- ANTES de que arranque el servicio `gotrue`. Se monta como
-- /docker-entrypoint-initdb.d/*.sql en `postgres-test` — corre siempre
-- (tmpfs = BD nueva en cada boot del stack, initdb.d nunca se saltea).
--
-- Causa raíz real (run de CI 32159780220, PR #541): GoTrue NO crea su propio
-- schema `auth` — sus migraciones (migrations/00_init_auth_schema.up.sql en
-- github.com/supabase/auth) hacen `CREATE TABLE IF NOT EXISTS auth.users`
-- directo, asumiendo que el schema YA existe. Sin esto, GoTrue moría con
-- "level":"fatal" / "schema \"auth\" does not exist" (SQLSTATE 3F000) apenas
-- arrancaba. El propio repo supabase/auth usa este mismo patrón para sus
-- tests (ver hack/init_postgres.sql: `CREATE SCHEMA IF NOT EXISTS auth ...`
-- antes de levantar GoTrue).
CREATE SCHEMA IF NOT EXISTS auth;

-- Segunda dependencia implícita, más adelante en la cadena de migraciones:
-- migrations/20240612123726_enable_rls_update_grants.up.sql hace
-- `grant select on auth.<tabla> to postgres with grant option` con el
-- nombre de rol "postgres" HARDCODEADO (no usa el namespace configurable).
-- Nuestro Postgres de test usa POSTGRES_USER=his (no se cambia a "postgres"
-- para no romper DATABASE_URL de Prisma/seed-test-users.mjs/etc. en el resto
-- del stack), así que el rol bootstrap de este cluster NO se llama
-- "postgres" — esa migración fallaría con "role \"postgres\" does not
-- exist" si no lo creamos. No necesita LOGIN ni privilegios: solo existir
-- como destino válido de GRANT.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres;
  END IF;
END
$$;
