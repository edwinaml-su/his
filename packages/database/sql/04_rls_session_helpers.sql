-- =============================================================================
-- HIS Multi-país | RLS Session Helpers (US-1.7)
--
-- Propósito:
--   `01_rls_policies.sql` lee el contexto de tenant desde claims JWT
--   (`request.jwt.claim.org_id`, `request.jwt.claims`). Eso funciona cuando
--   Supabase enruta la petición vía PostgREST/Auth, pero los tests Vitest
--   conectan con Prisma usando un connection string plano (sin JWT).
--
--   Este script extiende los helpers para que TAMBIÉN lean GUC seteados
--   manualmente vía `SET LOCAL app.current_user_id = '<uuid>'` y
--   `SET LOCAL app.current_org_id  = '<uuid>'`. Ambos modos coexisten:
--     1. JWT (producción runtime web vía Supabase).
--     2. SET LOCAL app.* (tests + jobs internos + tRPC defensa-en-profundidad).
--
--   Idempotente: se puede correr varias veces sin duplicar objetos.
-- =============================================================================

-- current_org_id: prioriza GUC `app.current_org_id`, luego cae a JWT.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    coalesce(
      current_setting('app.current_org_id', true),
      current_setting('request.jwt.claim.org_id', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')
    ),
    ''
  )::uuid;
$$;

-- current_user_id: prioriza GUC `app.current_user_id`, luego cae a JWT.
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    coalesce(
      current_setting('app.current_user_id', true),
      current_setting('request.jwt.claim.user_id', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'user_id')
    ),
    ''
  )::uuid;
$$;

-- is_break_glass: prioriza GUC `app.is_break_glass` ('true'/'false'),
-- luego cae a JWT claim `break_glass`.
CREATE OR REPLACE FUNCTION public.is_break_glass()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    NULLIF(current_setting('app.is_break_glass', true), '')::boolean,
    (current_setting('request.jwt.claims', true)::jsonb ->> 'break_glass')::boolean,
    false
  );
$$;

-- Helper de conveniencia: setea las 3 GUC en una sola llamada.
-- Uso típico en tRPC / tests:
--   SELECT public.set_tenant_context('<user_uuid>', '<org_uuid>', false);
--
-- Importante: usa SET LOCAL → solo dura la transacción actual.
-- El cliente DEBE envolver la query en una transacción para que aplique.
CREATE OR REPLACE FUNCTION public.set_tenant_context(
  p_user_id     uuid,
  p_org_id      uuid,
  p_break_glass boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_id', coalesce(p_user_id::text, ''), true);
  PERFORM set_config('app.current_org_id',  coalesce(p_org_id::text,  ''), true);
  PERFORM set_config('app.is_break_glass',  CASE WHEN p_break_glass THEN 'true' ELSE 'false' END, true);
END;
$$;

-- Helper inverso: limpia el contexto (útil para forzar "no tenant" en tests).
CREATE OR REPLACE FUNCTION public.clear_tenant_context()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_user_id', '', true);
  PERFORM set_config('app.current_org_id',  '', true);
  PERFORM set_config('app.is_break_glass',  'false', true);
END;
$$;

COMMENT ON FUNCTION public.set_tenant_context(uuid, uuid, boolean) IS
  'US-1.7 — Setea GUC de tenant para RLS. Requiere transacción (SET LOCAL).';
COMMENT ON FUNCTION public.clear_tenant_context() IS
  'US-1.7 — Limpia GUC de tenant; queries posteriores ven 0 filas si RLS está activa.';
