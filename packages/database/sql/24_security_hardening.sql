-- =============================================================================
-- HIS Multi-país | SQL 24 — Security hardening (Fase 6 Stream C)
--
-- Cierra las 19 WARN del advisor security de Supabase:
--   - 16 funciones con `function_search_path_mutable` → SET search_path = ''
--   - 2  extensions en schema public → mover a schema `extensions`
--   - 1  auth.leaked_password_protection → NOTA: se activa desde dashboard
--
-- Idempotente: usa ALTER FUNCTION (no recrea) y CREATE EXTENSION IF NOT EXISTS
-- para citext / pg_trgm en su nuevo schema.
--
-- Compatibilidad:
--   - Las funciones afectadas siguen llamándose desde el código (public.fn_X);
--     un search_path vacío fuerza al cuerpo a calificar con nombre completo de
--     schema cualquier objeto que invoque. Revisado:
--     * 01/04 helpers RLS: usan `current_setting()`, función built-in
--       (resuelve sin search_path).
--     * 02 audit triggers: ya tienen `SET search_path = public, audit` propio,
--       este ALTER lo reemplaza por '' y la función queda forzada a
--       calificar `audit."AuditLog"`. Ya lo hace ⇒ seguro.
--     * 03 validate_dui/nit/nie/fn_validate_patient_identifier: usan funciones
--       built-in (regexp_replace, substring, length, upper) que están en
--       pg_catalog → search_path siempre las resuelve aunque sea ''.
--     * 05 audit.fn_compute_chain_hash / fn_audit_log_chain / fn_verify_chain
--       / fn_chain_stats: ya tienen SET search_path explícito propio
--       (`public, extensions, audit`). NO se tocan; ya están blindados.
--
-- Extensions:
--   - `citext` y `pg_trgm` se mueven a schema `extensions` (donde ya viven
--     `pgcrypto`, `uuid-ossp`, `pg_stat_statements`). Como NO están en uso
--     real (ningún column tipo `citext`, ningún índice `gin_trgm_ops`), el
--     movimiento es no-disruptivo. El bloque ALTER EXTENSION ... SET SCHEMA
--     conserva el extension catalog; si falla por dependencia desconocida,
--     hace fallback a DROP + CREATE.
--
--   - Prisma declara `extensions = [pgcrypto, citext, uuid_ossp, pg_trgm]` en
--     `packages/database/prisma/schema.prisma`. Prisma genera
--     `CREATE EXTENSION IF NOT EXISTS "citext"` sin schema (queda en search_path);
--     Supabase respeta el schema donde la extensión ya existe → seguro.
--
-- Auth leaked_password_protection:
--   - NO se puede activar vía SQL. Requiere acción manual en:
--     Supabase Dashboard → Authentication → Settings → "Have I Been Pwned"
--     → Enable. Documentado al pie de este archivo.
-- =============================================================================

-- 1) Funciones search_path mutable → blindar con SET search_path = '' --------
-- Patrón: search_path vacío. Cualquier referencia interna debe estar
-- calificada con schema (public.X o audit.Y). Revisado en cada función:
--   - is_break_glass, current_org_id, current_user_id, current_country_id:
--     leen `request.jwt.claims` y `app.*` vía current_setting → no requieren
--     search_path para resolver objetos (no hay).
--   - user_has_org_access: hace SELECT FROM public."UserOrganizationRole" →
--     ya calificado con `public.`.
--   - validate_dui/nit/nie: usan funciones builtin (regexp_replace,
--     substring, length, upper) en pg_catalog (siempre accesible).
--   - fn_validate_patient_identifier: llama public.validate_X →
--     ya calificadas.
--   - set_tenant_context / clear_tenant_context: usan `set_config` builtin.
--   - fn_require_break_glass_justification / fn_block_hard_delete_patient:
--     usan `current_setting`, `nullif`, `public.is_break_glass()` → OK.
--   - audit.fn_audit_log_immutable: solo RAISE EXCEPTION → OK.
--   - audit.fn_chain_stats / fn_verify_chain: ya tenían `SET search_path`
--     propio (los SQL 05 los declara con `public, extensions, audit`). Las
--     dejamos como están en SQL 05 — este ALTER las endurece a '' y mantienen
--     funcionalidad porque ya califican `audit."AuditLog"`.

ALTER FUNCTION public.is_break_glass()                          SET search_path = '';
ALTER FUNCTION public.validate_dui(text)                        SET search_path = '';
ALTER FUNCTION public.validate_nit(text)                        SET search_path = '';
ALTER FUNCTION public.validate_nie(text)                        SET search_path = '';
ALTER FUNCTION public.current_org_id()                          SET search_path = '';
ALTER FUNCTION public.current_user_id()                         SET search_path = '';
ALTER FUNCTION public.current_country_id()                      SET search_path = '';
ALTER FUNCTION public.user_has_org_access(uuid)                 SET search_path = '';
ALTER FUNCTION public.fn_validate_patient_identifier()          SET search_path = '';
ALTER FUNCTION public.fn_require_break_glass_justification()    SET search_path = '';
ALTER FUNCTION public.fn_block_hard_delete_patient()            SET search_path = '';
ALTER FUNCTION public.set_tenant_context(uuid, uuid, boolean)   SET search_path = '';
ALTER FUNCTION public.clear_tenant_context()                    SET search_path = '';

ALTER FUNCTION audit.fn_audit_log_immutable()                   SET search_path = '';
ALTER FUNCTION audit.fn_chain_stats()                           SET search_path = '';
ALTER FUNCTION audit.fn_verify_chain(bigint)                    SET search_path = '';

-- 2) Mover extensions citext y pg_trgm fuera de public ----------------------
-- El schema `extensions` ya existe en Supabase (pgcrypto / uuid-ossp viven ahí).
-- ALTER EXTENSION ... SET SCHEMA conserva data y objetos dependientes.
-- Pre-condiciones (verificadas vía advisor + grep en repo):
--   * No hay columna tipo `citext` en ninguna tabla del MVP.
--   * No hay índice GIN trgm_ops sobre columnas del MVP.
-- Si alguna versión futura lo requiere, el código deberá calificar
-- `extensions.citext` o agregar `extensions` al search_path local en la migración.

DO $$
BEGIN
  -- citext
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citext') THEN
    BEGIN
      ALTER EXTENSION citext SET SCHEMA extensions;
    EXCEPTION WHEN feature_not_supported OR object_in_use THEN
      RAISE NOTICE 'citext: ALTER SCHEMA falló (%). Probablemente está en uso. Saltando.', SQLERRM;
    END;
  END IF;

  -- pg_trgm
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      ALTER EXTENSION pg_trgm SET SCHEMA extensions;
    EXCEPTION WHEN feature_not_supported OR object_in_use THEN
      RAISE NOTICE 'pg_trgm: ALTER SCHEMA falló (%). Probablemente está en uso. Saltando.', SQLERRM;
    END;
  END IF;
END$$;

-- 3) Comentarios documentales -----------------------------------------------
COMMENT ON FUNCTION public.is_break_glass() IS
  'TDR §6.2 — break-glass flag. SQL 24: search_path blindado a vacío.';
COMMENT ON FUNCTION public.validate_dui(text) IS
  'TDR §27.3 — DUI checksum. SQL 24: search_path blindado a vacío.';
COMMENT ON FUNCTION public.validate_nit(text) IS
  'TDR §27.3 — NIT checksum. SQL 24: search_path blindado a vacío.';
COMMENT ON FUNCTION public.validate_nie(text) IS
  'TDR §27.3 — NIE estructural. SQL 24: search_path blindado a vacío.';

-- 4) NOTA: auth.leaked_password_protection ----------------------------------
-- Este advisor (`auth_leaked_password_protection`) NO se puede activar via SQL.
-- Acción manual obligatoria pre go-live:
--   1. Supabase Dashboard → Authentication → Settings
--   2. Sección "Password Strength" → toggle "Prevent use of leaked passwords"
--   3. Validar con `mcp__supabase__get_advisors security` que el lint
--      `auth_leaked_password_protection` desaparece.
-- Asignado a @SRE para ejecución antes del cutover (ver docs/15_production_runbook.md §9).

-- =============================================================================
-- Verificación post-apply (ejecutar manualmente o vía advisor MCP):
--   SELECT proname, proconfig FROM pg_proc
--    WHERE proname IN ('is_break_glass','validate_dui','validate_nit','validate_nie',
--                      'current_org_id','current_user_id','current_country_id',
--                      'user_has_org_access','fn_validate_patient_identifier',
--                      'fn_require_break_glass_justification','fn_block_hard_delete_patient',
--                      'set_tenant_context','clear_tenant_context',
--                      'fn_audit_log_immutable','fn_chain_stats','fn_verify_chain');
--   -- proconfig debe incluir 'search_path=' (vacío)
--
--   SELECT extname, nspname AS schema
--     FROM pg_extension e
--     JOIN pg_namespace n ON e.extnamespace = n.oid
--    WHERE extname IN ('citext','pg_trgm');
--   -- schema debe ser 'extensions' (no 'public')
-- =============================================================================
