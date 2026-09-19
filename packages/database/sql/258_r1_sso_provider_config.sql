-- =============================================================================
-- 258_r1_sso_provider_config.sql — Persistencia real de configuración SSO
-- por organización (R1.4, plan de remediación 2026-09, NO aplicar sin OK Edwin)
--
-- Contexto: `/admin/sso-config` guardaba en localStorage (nunca llegaba a BD)
-- y `apps/web/src/app/actions/sso.ts:listSsoProvidersForLogin` devolvía una
-- constante mock hardcodeada — la pantalla admin era puramente cosmética.
-- El flujo de login REAL (botón "Iniciar con Microsoft" en /login) no lee
-- esta tabla: usa el provider `azure` de Supabase Auth nativo, configurado
-- directo en el dashboard de Supabase, gateado por el env var
-- NEXT_PUBLIC_AUTH_MICROSOFT_ENABLED. Esta tabla alimenta el flujo SSO
-- alterno (`/sso`, `/sso-config`) hoy 100% stub (initiateSsoLogin siempre
-- devuelve NOT_CONFIGURED) — persistir la config real no activa SSO por sí
-- solo, pero saca la pantalla admin de localStorage.
--
-- Decisión de diseño — SIN client secrets en esta tabla:
--   El client_secret de OIDC/OAuth2 (WorkOS, Auth0, Google, Azure) es un
--   secreto de aplicación, no un dato de negocio por-organización con el
--   perfil de acceso de esta tabla (leída por `listSsoProvidersForLogin`,
--   un Server Action que hoy es efectivamente público — sin sesión — para
--   poder mostrar el selector de provider ANTES de autenticar). Si el flujo
--   real de login usa secrets hoy, viven en env/Vercel (ninguno lo hace: el
--   provider azure real está configurado en Supabase, no en esta app). Esta
--   tabla solo persiste metadata NO sensible: provider, displayName,
--   enabled, y un `config` jsonb con lo no-secreto (clientId, redirectUri,
--   organizationDomain, autoProvision, roleClaimMap). Si Sprint futuro
--   necesita un client_secret real por-org, va a Supabase Vault (mismo
--   patrón que PortalAccount.mfaSecret, ver CLAUDE.md §Vault), nunca a una
--   columna ni a `config` en claro.
--
-- RLS: patrón tenant clásico (current_org_id()) + demote a `authenticated`
-- vía withTenantContext — igual que LabSlaConfig (sql/251) e
-- ImagingSlaConfig (sql/253). Sin GUC propio.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public."SsoProviderConfig" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"     uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  provider             varchar(30) NOT NULL
    CHECK (provider IN ('WORKOS', 'AUTH0', 'GOOGLE_WORKSPACE', 'AZURE_AD')),
  "displayName"        varchar(100) NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  -- Metadata NO sensible: clientId, redirectUri, organizationDomain,
  -- autoProvision, roleClaimMap. NUNCA clientSecret (ver cabecera).
  config               jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now()
);

-- Un provider por organización (idempotente por upsert desde el router).
CREATE UNIQUE INDEX IF NOT EXISTS "SsoProviderConfig_organizationId_provider_key"
  ON public."SsoProviderConfig" ("organizationId", provider);

CREATE INDEX IF NOT EXISTS "SsoProviderConfig_enabled_idx"
  ON public."SsoProviderConfig" (enabled) WHERE enabled = true;

ALTER TABLE public."SsoProviderConfig" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SsoProviderConfig" TO authenticated;

DROP POLICY IF EXISTS sso_provider_config_tenant ON public."SsoProviderConfig";
CREATE POLICY sso_provider_config_tenant ON public."SsoProviderConfig"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_sso_provider_config_updated_at') THEN
      CREATE TRIGGER trg_sso_provider_config_updated_at BEFORE UPDATE ON public."SsoProviderConfig"
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
  END IF;
END $$;

-- Nota: `listSsoProvidersForLogin` (Server Action sin sesión, usado por la
-- pantalla PRE-login `/sso`) no puede pasar por withTenantContext (no hay
-- tenant todavía). Lee esta tabla con el cliente Prisma normal (bypass RLS,
-- rol de servicio) filtrando `enabled = true` explícito en código — mismo
-- perfil de exposición que `listSsoProvidersForLogin` ya tenía con el mock
-- (metadata pública de providers, sin secrets). El CRUD admin sí pasa
-- siempre por withTenantContext (ver sso-provider-config.router.ts).
