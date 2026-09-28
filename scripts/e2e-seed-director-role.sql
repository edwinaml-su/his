-- scripts/e2e-seed-director-role.sql
--
-- Crea el rol "Director" (code=DIR) en la organización operativa del stack
-- E2E efímero (docker-compose.test.yml). packages/database/sql/64_director_role.sql
-- hace lo mismo pero con el organizationId de PRODUCCIÓN hardcodeado
-- ('c7eabf29-a484-4a69-9426-9ee8b06d054a', Supabase real) — en el Postgres
-- efímero de CI esa fila no existe nunca (packages/database/prisma/seed.ts
-- genera ids nuevos en cada corrida vía gen_random_uuid()/faker), así que ese
-- INSERT no aplica acá y nunca se agregó al bootstrap de e2e.yml.
--
-- Sin esto, packages/database/scripts/seed-test-users.mjs nunca encuentra
-- `Role.name='Director'` (busca por nombre, "cualquiera de cualquier org
-- sirve") y qa.director@his.test queda sin rol asignado — log
-- `SIN ROLE "Director"`, verificado en corrida local 2026-09-27. Bloquea
-- TODAS las specs que hacen login(page, "director")
-- (requireRole(["DIR"]) en routers ECE de certificación/anulación/bitácora,
-- NTEC Art. 21): ece-roles-permisos.spec.ts,
-- ece-flujo-hospitalario-completo.spec.ts,
-- ece-flujo-hospitalario-defuncion.spec.ts, workflow-publish-rollback.spec.ts,
-- fase2/ece-workflow-completo.spec.ts, patient-merge.spec.ts,
-- integration/cross-sprint.spec.ts.
--
-- Resuelve la org operativa igual que seed-test-users.mjs (la que tiene
-- Establishment) en vez de un id fijo. Idempotente vía el mismo
-- @@unique([organizationId, code]) de Role que usa 64_director_role.sql.
INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), e."organizationId", 'DIR', 'Director',
       'Dirección del establecimiento — certifica documentos ECE (Art. 21 NTEC)',
       true, now(), now()
FROM (SELECT "organizationId" FROM public."Establishment" LIMIT 1) e
ON CONFLICT ("organizationId", code) DO NOTHING;
