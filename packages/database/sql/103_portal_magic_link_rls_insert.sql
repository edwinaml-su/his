-- =============================================================================
-- 103_portal_magic_link_rls_insert.sql — K-09: policy INSERT en PortalMagicLink
-- =============================================================================
-- Equivalente de 98_portal_rls_inserts.sql (aplicado anteriormente).
-- Este archivo sigue el número de secuencia pedido en el audit 2026-05-26.
-- Es idempotente: el DO block verifica si la policy ya existe antes de crearla.
--
-- Sin esta policy, el rol `authenticated` (usado por withPortalContext tras
-- democión con SET LOCAL ROLE) recibe DENIED implícito al INSERT en la tabla
-- porque RLS está habilitada pero no existe WITH CHECK para INSERT.
-- =============================================================================

DO $$
BEGIN
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
END;
$$;
