-- ============================================================================
-- 239_cc0032_super_admin_rbac_audit.sql
-- CC-0032 — cierre de escalación de privilegios RBAC (hallazgo C1, P0 de
-- seguridad, docs/audit/2026-09-15_cobertura/03-facturacion-admin-seguridad.md
-- P0-1/2/3 + 04-resumen-ejecutivo-y-cc0031.md §3).
--
-- ⚠️ PENDIENTE DE APLICAR — @Orq la aplica vía MCP Supabase tras revisión.
-- NO aplicar contra prod desde este worktree.
--
-- Decisión de Edwin Martinez (verbatim): "Procede solo Edwin Martinez es
-- Super Admin" — la administración de roles/permisos queda restringida a un
-- rol nuevo SUPER_ADMIN cuyo único titular hoy es el usuario
-- 2907f378-4eb8-443c-b458-e11cdd83311e (emartinez@complejoavante.com,
-- verificado en prod 2026-09-15).
--
-- Tres secciones, cada una idempotente:
--   1. Rol SUPER_ADMIN por organización activa (patrón de
--      sql/238_cc0031_roles_notificaciones.sql §1), heredando de ADMIN de la
--      misma org vía `inheritsFromRoleId` (CC-0017 — ver
--      packages/trpc/src/rbac/effective-roles.ts: la expansión de herencia
--      agrega el código del rol padre al set efectivo, así que
--      `requireRole(["ADMIN"])` sigue aceptando a un SUPER_ADMIN sin tocar
--      esos call sites).
--   2. UserOrganizationRole SUPER_ADMIN para Edwin en cada org donde ya
--      tiene membresía vigente.
--   3. Auditoría hash chain (mismo patrón/función que
--      sql/02_audit_triggers.sql, función `audit.fn_audit_row()` — NO se
--      inventa una función nueva) sobre Role, RolePermission,
--      UserOrganizationRole y RoleCodeAlias. `Role`/`RolePermission`/
--      `UserOrganizationRole` YA estaban en el array `audited` de
--      02_audit_triggers.sql (el DO block dinámico no aparece en un grep
--      literal de "CREATE TRIGGER ... Role", por eso el hallazgo A4 de la
--      auditoría los reportó como ausentes) — esta sección los deja
--      explícitos e idempotentes de nuevo (DROP TRIGGER IF EXISTS + CREATE)
--      y cierra el gap real: `RoleCodeAlias` nunca tuvo trigger.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rol SUPER_ADMIN — uno por organización activa, heredando de ADMIN.
-- ---------------------------------------------------------------------------

INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, 'SUPER_ADMIN', 'Super Administrador',
       'CC-0032 — administración de roles/permisos (RBAC) y usuarios. Único titular autorizado: Edwin Martinez.',
       true, now(), now()
FROM public."Organization" o
WHERE o.active = true
ON CONFLICT ("organizationId", code) DO NOTHING;

-- Enlaza la herencia SUPER_ADMIN -> ADMIN de la misma org (segundo paso para
-- no depender del orden de filas dentro del INSERT anterior; idempotente:
-- solo toca filas que aún no tienen inheritsFromRoleId seteado hacia ADMIN).
UPDATE public."Role" sa
SET "inheritsFromRoleId" = adm.id,
    "updatedAt" = now()
FROM public."Role" adm
WHERE sa.code = 'SUPER_ADMIN'
  AND adm.code = 'ADMIN'
  AND adm."organizationId" = sa."organizationId"
  AND sa."inheritsFromRoleId" IS DISTINCT FROM adm.id;

-- ---------------------------------------------------------------------------
-- 2. UserOrganizationRole SUPER_ADMIN para Edwin Martinez, en cada org donde
--    ya tiene membresía vigente (validTo NULL o >= now()).
-- ---------------------------------------------------------------------------

INSERT INTO public."UserOrganizationRole" (id, "userId", "organizationId", "roleId", "validFrom", "validTo")
SELECT gen_random_uuid(), u.id, existing."organizationId", sa.id, now(), NULL
FROM public."User" u
JOIN (
  SELECT DISTINCT "organizationId"
  FROM public."UserOrganizationRole"
  WHERE "userId" = '2907f378-4eb8-443c-b458-e11cdd83311e'::uuid
    AND "validFrom" <= now()
    AND ("validTo" IS NULL OR "validTo" >= now())
) existing ON true
JOIN public."Role" sa
  ON sa.code = 'SUPER_ADMIN' AND sa."organizationId" = existing."organizationId"
WHERE u.id = '2907f378-4eb8-443c-b458-e11cdd83311e'::uuid
ON CONFLICT ("userId", "organizationId", "roleId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Auditoría hash chain sobre las tablas RBAC — reusa audit.fn_audit_row()
--    (definida en sql/02_audit_triggers.sql, ya SECURITY DEFINER con
--    SET search_path = public, audit). Idempotente por tabla.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  audited text[] := ARRAY[
    'Role','RolePermission','UserOrganizationRole','RoleCodeAlias'
  ];
BEGIN
  FOREACH t IN ARRAY audited LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_'||t, t);
    EXECUTE format(
      'CREATE TRIGGER %I
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row()',
      'trg_audit_'||t, t
    );
  END LOOP;
END$$;
