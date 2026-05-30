-- =============================================================================
-- Migración 156: RLS en tablas de chat (BD-P0-2)
-- Remedia: chat_message, chat_session, chat_knowledge_chunk sin RLS habilitada.
--
-- Diseño:
--   chat_session    → organization_id directo → current_org_id()
--   chat_message    → organization_id directo → current_org_id()
--   chat_knowledge_chunk → base de conocimiento compartida (sin org_id).
--                    SELECT libre (authenticated); INSERT/UPDATE/DELETE solo ADMIN.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE POLICY.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. chat_session
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_session ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_session_select_tenant ON public.chat_session;
DROP POLICY IF EXISTS chat_session_insert_tenant ON public.chat_session;
DROP POLICY IF EXISTS chat_session_update_tenant ON public.chat_session;
DROP POLICY IF EXISTS chat_session_delete_tenant ON public.chat_session;

CREATE POLICY chat_session_select_tenant
  ON public.chat_session
  FOR SELECT
  USING (organization_id = current_org_id());

CREATE POLICY chat_session_insert_tenant
  ON public.chat_session
  FOR INSERT
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY chat_session_update_tenant
  ON public.chat_session
  FOR UPDATE
  USING (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY chat_session_delete_tenant
  ON public.chat_session
  FOR DELETE
  USING (organization_id = current_org_id());

-- ---------------------------------------------------------------------------
-- 2. chat_message
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_message ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_message_select_tenant ON public.chat_message;
DROP POLICY IF EXISTS chat_message_insert_tenant ON public.chat_message;
DROP POLICY IF EXISTS chat_message_update_tenant ON public.chat_message;
DROP POLICY IF EXISTS chat_message_delete_tenant ON public.chat_message;

CREATE POLICY chat_message_select_tenant
  ON public.chat_message
  FOR SELECT
  USING (organization_id = current_org_id());

CREATE POLICY chat_message_insert_tenant
  ON public.chat_message
  FOR INSERT
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY chat_message_update_tenant
  ON public.chat_message
  FOR UPDATE
  USING (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY chat_message_delete_tenant
  ON public.chat_message
  FOR DELETE
  USING (organization_id = current_org_id());

-- ---------------------------------------------------------------------------
-- 3. chat_knowledge_chunk
--    Sin organization_id — es base de conocimiento global compartida.
--    SELECT: cualquier usuario autenticado (todos los orgs pueden leer).
--    INSERT/UPDATE/DELETE: solo ADMIN de la org activa (gestión de contenido).
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_knowledge_chunk ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_knowledge_chunk_select_authenticated ON public.chat_knowledge_chunk;
DROP POLICY IF EXISTS chat_knowledge_chunk_insert_admin        ON public.chat_knowledge_chunk;
DROP POLICY IF EXISTS chat_knowledge_chunk_update_admin        ON public.chat_knowledge_chunk;
DROP POLICY IF EXISTS chat_knowledge_chunk_delete_admin        ON public.chat_knowledge_chunk;

-- Lectura: cualquier sesión autenticada (RAG queries desde cualquier org)
CREATE POLICY chat_knowledge_chunk_select_authenticated
  ON public.chat_knowledge_chunk
  FOR SELECT
  USING (true);

-- Escritura: requiere rol ADMIN en la org activa
CREATE POLICY chat_knowledge_chunk_insert_admin
  ON public.chat_knowledge_chunk
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "UserOrganizationRole" uor
      JOIN "Role" r ON r.id = uor."roleId"
      WHERE uor."userId"         = current_user_id()
        AND uor."organizationId" = current_org_id()
        AND r.code               = 'ADMIN'
        AND r.active             = true
        AND (uor."validTo" IS NULL OR uor."validTo" > now())
    )
  );

CREATE POLICY chat_knowledge_chunk_update_admin
  ON public.chat_knowledge_chunk
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM "UserOrganizationRole" uor
      JOIN "Role" r ON r.id = uor."roleId"
      WHERE uor."userId"         = current_user_id()
        AND uor."organizationId" = current_org_id()
        AND r.code               = 'ADMIN'
        AND r.active             = true
        AND (uor."validTo" IS NULL OR uor."validTo" > now())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "UserOrganizationRole" uor
      JOIN "Role" r ON r.id = uor."roleId"
      WHERE uor."userId"         = current_user_id()
        AND uor."organizationId" = current_org_id()
        AND r.code               = 'ADMIN'
        AND r.active             = true
        AND (uor."validTo" IS NULL OR uor."validTo" > now())
    )
  );

CREATE POLICY chat_knowledge_chunk_delete_admin
  ON public.chat_knowledge_chunk
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM "UserOrganizationRole" uor
      JOIN "Role" r ON r.id = uor."roleId"
      WHERE uor."userId"         = current_user_id()
        AND uor."organizationId" = current_org_id()
        AND r.code               = 'ADMIN'
        AND r.active             = true
        AND (uor."validTo" IS NULL OR uor."validTo" > now())
    )
  );
