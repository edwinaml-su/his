-- =============================================================================
-- 98_portal_rls_inserts.sql — K-09: policy INSERT faltante en PortalMagicLink
-- =============================================================================
-- Hallazgo: RLS habilitado + SELECT policy existen en SQL 52, pero INSERT no
-- tenía policy → rol authenticated recibe DENIED implícito al insertar.
-- withPortalContext demota a authenticated; si requestLogin migra de ctx.prisma
-- (BYPASSRLS) a withPortalContext, las inserciones fallarán sin esta policy.
--
-- Nota de aplicación: si SQL 52 aún no ha sido aplicado (tablas portal
-- inexistentes), este DO block es no-op idempotente. Se ejecutará efectivamente
-- la próxima vez que se corra esta migration si la tabla ya existe.
--
-- GUC: app.current_portal_account — seteado por withPortalContext / applyPortalContext.
-- Helper: public.current_portal_account() definida en SQL 52.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'PortalMagicLink'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'PortalMagicLink'
        AND policyname = 'portal_magic_link_insert'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY portal_magic_link_insert ON "PortalMagicLink"
          FOR INSERT TO authenticated
          WITH CHECK ("accountId" = public.current_portal_account())
      $pol$;
    END IF;
  END IF;
END;
$$;
