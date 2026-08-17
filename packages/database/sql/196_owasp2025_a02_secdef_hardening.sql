-- =============================================================================
-- 196 — OWASP A02:2025 (Security Misconfiguration) — superficie PostgREST
-- =============================================================================
-- Contexto: los advisors de Supabase reportan que 8 funciones SECURITY DEFINER
-- son invocables por `anon` vía `/rest/v1/rpc/<fn>` (lint 0028) y por
-- `authenticated` (lint 0029). SECDEF significa que corren con los privilegios
-- del owner (`postgres`), así que un caller anónimo con la anon key pública
-- podía ejecutar lógica privilegiada sin sesión: consumir secuencias, expirar
-- reservas de farmacia y — lo más grave — leer/escribir el secreto TOTP del
-- portal del paciente (`get_portal_mfa_secret`).
--
-- Criterio aplicado por función:
--   * `anon`          → SIEMPRE revocado. Ningún flujo anónimo las necesita.
--   * `authenticated` → revocado sólo donde se verificó que la app NO las llama
--                       bajo `withTenantContext`/`withPortalContext` (que demotan
--                       el rol). Ver justificación por bloque.
--
-- El rol de la app (`postgres.<ref>` → `postgres`) y `service_role` conservan
-- EXECUTE en todas: los routers y los cron jobs siguen funcionando.
--
-- Idempotente: REVOKE/GRANT y ALTER FUNCTION ... SET son repetibles.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Secretos MFA del portal (BD P0-6 / Vault).
--    Call sites: packages/trpc/src/routers/portal.router.ts usa `ctx.prisma`
--    directo (rol base, sin demote) → revocar a authenticated no los rompe.
--    Es el hallazgo de mayor impacto: exponía el secreto TOTP en claro.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_portal_mfa_secret(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_portal_mfa_secret_vault(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) Mantenimiento / cron. Sin call sites en la app (verificado por grep sobre
--    packages/trpc, apps/web y packages/database).
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_hits()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_pharmacy_reservations()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_expire_pharmacy_reservations()
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) Generadores de correlativos (expediente, cuenta, no identificado,
--    solicitud de imagen). La app SÍ los invoca con el `tx` de
--    `withTenantContext` (rol demotado a `authenticated`), así que ese rol
--    conserva EXECUTE; sólo se cierra el acceso anónimo.
--    Sin esto, `anon` podía quemar correlativos del expediente único a voluntad.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.fn_next_cuenta(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_next_expediente(char, char) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_next_no_identificado(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_next_solicitud_imagen(uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_next_cuenta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_next_expediente(char, char) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_next_no_identificado(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_next_solicitud_imagen(uuid, integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) `current_portal_account()` la evalúan las policies RLS del portal
--    (PortalAccount, PortalSession, PortalMagicLink, GuardianRelationship —
--    todas para el rol `authenticated`). Revocarle EXECUTE a `authenticated`
--    rompería el portal entero; sólo se cierra `anon`.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.current_portal_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_portal_account() TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) `search_path` mutable — última función pendiente tras SQL 155/162.
--    Sin `SET search_path`, un rol que controle su propio search_path puede
--    resolver `now()`/operadores a objetos suyos (CWE-426).
-- -----------------------------------------------------------------------------
ALTER FUNCTION gs1.set_updated_at() SET search_path = gs1, public, pg_catalog;

-- =============================================================================
-- Verificación
--   select proname, proacl from pg_proc where proname = 'get_portal_mfa_secret';
--     → sin `anon=X` ni `authenticated=X`
--   Advisors: lint 0028/0029 deben quedar sólo con funciones intencionalmente
--   públicas (ninguna, tras este script).
-- =============================================================================
