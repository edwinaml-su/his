-- =============================================================================
-- 250_desactivar_orgs_rls_test.sql
-- Limpieza de datos de prueba en prod: ~20 organizaciones `RLS-Test-OrgA/B-*`
-- visibles en el selector de organización (hallazgo fuera-de-alcance del
-- FIX-establishment-list-uuid §5, 2026-09-16).
--
-- Origen de los datos: `packages/trpc/src/__tests__/rls-isolation.test.ts`
-- crea 2 orgs + 2 pacientes por corrida y limpia en `afterAll` — pero una
-- corrida abortada deja huérfanos. Los pacientes `MRN-A/B-*` tienen FK a la
-- org (`onDelete: Restrict` implícito), por eso NO se borra: se desactiva.
-- Todos los seeders/importadores ya excluyen `legalName LIKE 'RLS-Test%'`.
--
-- ⚠️ PROPUESTO — NO APLICADO a prod. Pendiente revisión de Edwin.
--    Solo UPDATE de `active` (reversible); cero DELETE.
--
-- NOTA para la revisión: `GET /api/session/context` (el endpoint que puebla
-- el OrgRoleSwitcher) hoy NO filtra por `Organization.active` — lista toda
-- org donde el usuario tenga membresía vigente en "UserOrganizationRole".
-- Desactivar estas orgs NO las oculta del switcher por sí solo; eso lo
-- resuelve la decisión pendiente de filtrado del switcher (holdings / orgs
-- sin establecimientos activos / active=false). El bloque B (comentado)
-- ofrece la alternativa de expirar las membresías, que SÍ las oculta hoy.
-- =============================================================================

-- Inventario previo (correr primero, adjuntar al PR/revisión):
SELECT id, "legalName", active, "createdAt"
FROM "Organization"
WHERE "legalName" LIKE 'RLS-Test%'
ORDER BY "createdAt";

-- ── A) Desactivación (idempotente) ───────────────────────────────────────────
UPDATE "Organization"
SET active = false,
    "updatedAt" = now()
WHERE "legalName" LIKE 'RLS-Test%'
  AND active = true;

-- ── B) OPCIONAL (comentado — decisión de Edwin): expirar membresías hacia
--      orgs RLS-Test para que dejen de listarse en el switcher HOY, sin
--      esperar el cambio de filtrado en /api/session/context. Reversible
--      (validTo vuelve a NULL). Solo afecta membresías de usuarios de prueba;
--      verificar con el SELECT antes de descomentar.
-- SELECT uor."userId", u.email, o."legalName"
-- FROM "UserOrganizationRole" uor
-- JOIN "Organization" o ON o.id = uor."organizationId"
-- JOIN "User" u ON u.id = uor."userId"
-- WHERE o."legalName" LIKE 'RLS-Test%'
--   AND (uor."validTo" IS NULL OR uor."validTo" >= now());
--
-- UPDATE "UserOrganizationRole" uor
-- SET "validTo" = now()
-- FROM "Organization" o
-- WHERE o.id = uor."organizationId"
--   AND o."legalName" LIKE 'RLS-Test%'
--   AND (uor."validTo" IS NULL OR uor."validTo" >= now());

-- Verificación posterior: debe devolver 0 filas activas.
SELECT count(*) AS rls_test_activas
FROM "Organization"
WHERE "legalName" LIKE 'RLS-Test%'
  AND active = true;
