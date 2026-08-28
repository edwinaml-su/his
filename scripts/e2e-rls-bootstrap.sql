-- scripts/e2e-rls-bootstrap.sql
--
-- Bootstrap mínimo para que `withTenantContext` (packages/trpc/src/rls-context.ts)
-- no reviente en la BD efímera de CI (docker-compose.test.yml, Postgres 15-alpine
-- plano, SIN Supabase). Diagnóstico (2026-08-28, run 33199823168 de
-- e2e-smoke.yml): "Sync schema to ephemeral DB" solo corre `prisma db push`, que
-- crea las tablas de schema.prisma pero NO el corpus SQL hand-rolled de
-- packages/database/sql/ (CLAUDE.md §Schema drift). Sin esto, CUALQUIER router
-- que llame `withTenantContext`/`applyTenantContext` falla en la primera línea
-- con `function public.set_tenant_context(uuid, uuid, boolean) does not exist`
-- — eso tumbaba TODAS las specs @smoke (bed.getMap, costCenter.list,
-- encounterTransfer.listRecent, etc. vía admission-discharge.spec.ts).
--
-- Junto con `packages/database/sql/04_rls_session_helpers.sql` (aplicado en
-- un paso `prisma db execute` separado, ver e2e-smoke.yml), este archivo
-- aplica solo lo estrictamente necesario para que `withTenantContext` tenga
-- éxito end-to-end en un Postgres vacío:
--   1. Los roles `anon`/`authenticated`/`service_role` (primitivas nativas de
--      Postgres en Supabase, NO creadas por ningún archivo del corpus SQL —
--      bootstrap documentado y verificado en
--      docs/runbooks/db-reconstruccion-fuera-de-supabase.md §4.1).
--   2. Membresía + grants amplios sobre `authenticated` en los 3 schemas de
--      Prisma (public/audit/ece): SIN esto, `SET LOCAL ROLE authenticated`
--      sí tendría éxito pero toda query subsiguiente fallaría con "permission
--      denied" (las tablas quedan owned por `his`, el rol que corrió
--      `prisma db push`, y Postgres deniega por default a roles no-owner).
--
-- Deliberadamente NO aplica 01_rls_policies.sql ni el resto del corpus RLS
-- module-por-module (09/10/11/45/47/... _rls.sql): ese trabajo es el de
-- portar el corpus completo fuera de Supabase (ver runbook, ~36/227 archivos
-- fallan hoy fuera de Supabase) y está fuera de alcance de "smoke verde". Sin
-- políticas RLS creadas, ENABLE ROW LEVEL SECURITY nunca se activó en estas
-- tablas, así que los GRANT amplios de abajo no bypasean ninguna política —
-- simplemente igualan el comportamiento MVP documentado en rls-context.ts
-- ("Sprint 1: el filtro tenant vive en aplicación, este helper es defensa en
-- profundidad opcional").
--
-- Idempotente: seguro de correr en cada boot del stack efímero (tmpfs, BD
-- nueva cada vez), pero los IF NOT EXISTS/OR REPLACE no rompen si se corre
-- dos veces.
--
-- NO incluye las funciones de 04_rls_session_helpers.sql — ese archivo se
-- aplica en un paso `prisma db execute` separado (ver e2e-smoke.yml) para no
-- duplicar su contenido acá; `prisma db execute --file` no soporta `\i` de
-- psql, así que no puede incluirse por referencia dentro de este archivo.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- `his` es el usuario de conexión (docker-compose.test.yml, POSTGRES_USER).
-- Necesita ser miembro de `authenticated` para que `SET LOCAL ROLE
-- authenticated` (rls-context.ts) tenga permiso de cambiar a ese rol.
GRANT authenticated TO his;

GRANT USAGE ON SCHEMA public, audit, ece TO authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public, audit, ece TO authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public, audit, ece TO authenticated;
