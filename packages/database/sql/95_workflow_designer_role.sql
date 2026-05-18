-- ============================================================================
-- 95_workflow_designer_role.sql
-- Crea el rol "Workflow Designer" (code=WORKFLOW_DESIGNER) en public.Role.
--
-- Motivación: requireRole(["WORKFLOW_DESIGNER", "DIR"]) en todos los routers
-- del motor de workflow ECE necesita match en public.Role.code para que
-- `tenant.roleCodes` lo incluya al construir el contexto de sesión.
--
-- Solo este rol + DIR + ADMIN pueden crear/editar/publicar workflows (US.F2.2.14).
--
-- Idempotente: ON CONFLICT DO NOTHING.
-- ============================================================================

INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'c7eabf29-a484-4a69-9426-9ee8b06d054a'::uuid,  -- org operativa AVANTE
  'WORKFLOW_DESIGNER',
  'Workflow Designer',
  'Diseñador de flujos clínicos — puede crear, editar y publicar workflows (US.F2.2.14 NTEC Art. 21)',
  true,
  now(),
  now()
)
ON CONFLICT DO NOTHING;
