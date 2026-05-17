-- ============================================================================
-- 64_director_role.sql
-- Crea el rol "Director" (code=DIR) en la organización operativa principal.
--
-- Motivación: requireRole(["DIR"]) en routers ECE (certificación de
-- documentos, anulación, autorización de rectificaciones) necesita match en
-- public.Role.code. El schema ECE define DIR en ece.rol pero el RBAC del HIS
-- requiere mapping en public.Role para que `tenant.roleCodes` lo incluya.
--
-- Norma: NTEC Art. 21 — solo la Dirección certifica copias formales de
-- FICHA_ID, EPICRISIS, CERT_DEF.
--
-- Idempotente: ON CONFLICT DO NOTHING.
-- ============================================================================

INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'c7eabf29-a484-4a69-9426-9ee8b06d054a'::uuid,  -- org operativa AVANTE
  'DIR',
  'Director',
  'Dirección del establecimiento — certifica documentos ECE (Art. 21 NTEC)',
  true,
  now(),
  now()
)
ON CONFLICT DO NOTHING;
