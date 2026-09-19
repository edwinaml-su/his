-- ============================================================================
-- 256_cc_b_roles_corporativos.sql
-- CC-B — roles corporativos/país para visión consolidada de operaciones
-- (directriz de Edwin Martinez, 2026-09-19, verbatim resumido): "el acceso a
-- multi-libro podría asociarse a roles específicos para una visión
-- corporativa y completa de las operaciones, además de tener roles
-- específicos por país y por organización".
--
-- ⚠️ NO APLICADO — @Orq decide cuándo correr esto contra Supabase.
--
-- Patrón: idéntico a sql/239_cc0032_super_admin_rbac_audit.sql §1 (rol por
-- organización activa, `ON CONFLICT ("organizationId", code) DO NOTHING`).
-- A diferencia de 239, esta migración NO asigna membresías
-- (`UserOrganizationRole`) — Edwin asigna a mano por país/organización en
-- runtime; el rol es solo la palanca. Tampoco enlaza herencia
-- (`inheritsFromRoleId`): CONTRALOR_CORP y DIR_PAIS son roles de VISIBILIDAD
-- (lectura consolidada), no una escalación de privilegios de escritura sobre
-- el rol ADMIN, así que no corresponde que hereden sus permisos.
--
-- Dos roles nuevos, uno por organización activa:
--   CONTRALOR_CORP — "Contralor corporativo": visión consolidada de
--     operaciones y multi-libro (lectura). Cableado en
--     packages/trpc/src/routers/accounting.router.ts (chart/period/journal/
--     costCenter .list) y packages/trpc/src/routers/ledger.router.ts
--     (list/get/roundingPolicy vía `assertLedgerReadMembership`).
--   DIR_PAIS — "Director de país": dirección sobre las organizaciones de un
--     país. La asignación de membresías por país la hace el ADMIN a mano
--     (no hay columna countryId en UserOrganizationRole hoy — el alcance por
--     país se logra dándole membresía en cada organización de ese país).
--
-- Ambos se agregan a MULTI_ORG_ROLE_CODES
-- (apps/web/src/lib/auth/multi-org-roles.ts) junto con SUPER_ADMIN, para que
-- el switcher cross-org (cookie `his.orgs`) los reconozca.
--
-- Idempotente — seguro de re-correr.
-- ============================================================================

INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, 'CONTRALOR_CORP', 'Contralor Corporativo',
       'CC-B — visión consolidada de operaciones y multi-libro contable (lectura). '
       'No otorga permisos de escritura sobre asientos/cuentas/períodos ni sobre libros.',
       true, now(), now()
FROM public."Organization" o
WHERE o.active = true
ON CONFLICT ("organizationId", code) DO NOTHING;

INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, 'DIR_PAIS', 'Director de País',
       'CC-B — dirección sobre las organizaciones de un país. La asignación de '
       'membresías por país la hace el ADMIN manualmente (UserOrganizationRole '
       'por cada organización del país); este rol es la palanca de autorización.',
       true, now(), now()
FROM public."Organization" o
WHERE o.active = true
ON CONFLICT ("organizationId", code) DO NOTHING;

-- ============================================================================
-- Verificación manual post-apply:
--   SELECT "organizationId", code, count(*) FROM public."Role"
--     WHERE code IN ('CONTRALOR_CORP','DIR_PAIS') GROUP BY 1,2;
--   -- esperado: 1 fila por organización activa por cada code, count=1.
--   SELECT count(*) FROM public."UserOrganizationRole" uor
--     JOIN public."Role" r ON r.id = uor."roleId"
--     WHERE r.code IN ('CONTRALOR_CORP','DIR_PAIS');
--   -- esperado: 0 (sin membresías — asignación manual pendiente de Edwin).
-- ============================================================================
