-- =============================================================================
-- HIS Multi-país | RLS Policies — auth/audit/financial gap closure (G0)
-- TDR §5.5 + §6.3.
--
-- Cobertura faltante en 01_rls_policies.sql:
--   1. audit.AuditLog        — read tenant-scoped (escritura via SECURITY DEFINER)
--   2. public.User           — sólo own + same-org via UserOrganizationRole
--   3. public.UserCredential — sólo own
--   4. public.UserExternalIdentity — sólo own
--   5. public.Session        — sólo own user O admin de la org
--   6. public.RolePermission — hereda de Role
--   7. public.DeathCertificate — tenant_isolation (organizationId directo)
--   8. public.PatientVaccination — tenant_isolation (organizationId directo)
--   9. public.ExchangeRate   — SELECT global; mutación service_role only
--
-- Idempotente. Reusa helpers de 01 + GUC bridge de 04.
-- =============================================================================

-- 1) Enable RLS sobre las 9 tablas críticas ----------------------------------
ALTER TABLE audit."AuditLog"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UserCredential"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UserExternalIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Session"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RolePermission"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DeathCertificate"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientVaccination"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ExchangeRate"        ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- audit.AuditLog
--   Trigger fn_audit_row() ya usa SECURITY DEFINER (bypassa RLS al insertar).
--   Trigger trg_auditlog_no_update bloquea UPDATE/DELETE/TRUNCATE.
--   Sólo necesitamos policy de SELECT y grants de USAGE/SELECT al rol app.
-- =============================================================================

-- Sin GRANT USAGE, ningún rol non-superuser puede entrar al schema audit
-- (independiente de RLS). El rol "authenticated" es el que asume la sesión
-- post-Supabase-auth + el que tests demote-rolean a vía SET LOCAL ROLE.
GRANT USAGE ON SCHEMA audit TO authenticated, anon, service_role;
GRANT SELECT ON audit."AuditLog" TO authenticated, service_role;

DROP POLICY IF EXISTS auditlog_tenant_select ON audit."AuditLog";
CREATE POLICY auditlog_tenant_select ON audit."AuditLog"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

-- =============================================================================
-- User: visible si es uno mismo O comparte org via UserOrganizationRole.
--       Modificación: sólo el propio usuario sobre su row (admin crea via service_role).
-- =============================================================================
DROP POLICY IF EXISTS user_self_or_same_org_select ON public."User";
CREATE POLICY user_self_or_same_org_select ON public."User"
  FOR SELECT
  USING (
    id = public.current_user_id()
    OR EXISTS (
      SELECT 1 FROM public."UserOrganizationRole" uor
       WHERE uor."userId" = public."User".id
         AND uor."organizationId" = public.current_org_id()
         AND (uor."validTo" IS NULL OR uor."validTo" > now())
    )
    OR public.is_break_glass()
  );

DROP POLICY IF EXISTS user_self_modify ON public."User";
CREATE POLICY user_self_modify ON public."User"
  FOR ALL
  USING (id = public.current_user_id())
  WITH CHECK (id = public.current_user_id());

-- =============================================================================
-- UserCredential / UserExternalIdentity / Session
--   Estrictamente del propio usuario. Admin debe usar service_role.
-- =============================================================================
DROP POLICY IF EXISTS user_cred_self ON public."UserCredential";
CREATE POLICY user_cred_self ON public."UserCredential"
  FOR ALL
  USING ("userId" = public.current_user_id())
  WITH CHECK ("userId" = public.current_user_id());

DROP POLICY IF EXISTS user_extid_self ON public."UserExternalIdentity";
CREATE POLICY user_extid_self ON public."UserExternalIdentity"
  FOR ALL
  USING ("userId" = public.current_user_id())
  WITH CHECK ("userId" = public.current_user_id());

-- Session: own user, o mismos admins de la org pueden ver (para revocar).
DROP POLICY IF EXISTS session_self_or_org_select ON public."Session";
CREATE POLICY session_self_or_org_select ON public."Session"
  FOR SELECT
  USING (
    "userId" = public.current_user_id()
    OR ("organizationId" = public.current_org_id() AND public.is_break_glass())
  );

DROP POLICY IF EXISTS session_self_modify ON public."Session";
CREATE POLICY session_self_modify ON public."Session"
  FOR ALL
  USING ("userId" = public.current_user_id())
  WITH CHECK ("userId" = public.current_user_id());

-- =============================================================================
-- RolePermission: hereda tenant scope de Role (que ya tiene RLS por org).
-- =============================================================================
DROP POLICY IF EXISTS role_perm_inherits_role ON public."RolePermission";
CREATE POLICY role_perm_inherits_role ON public."RolePermission"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."Role" r
     WHERE r.id = "roleId"
       AND r."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Role" r
     WHERE r.id = "roleId"
       AND r."organizationId" = public.current_org_id()
  ));

-- =============================================================================
-- DeathCertificate / PatientVaccination: organizationId directo (tenant_isolation).
-- =============================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['DeathCertificate','PatientVaccination'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON public.%I
         FOR SELECT
         USING ("organizationId" = public.current_org_id() OR public.is_break_glass())',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_modify ON public.%I
         FOR ALL
         USING ("organizationId" = public.current_org_id())
         WITH CHECK ("organizationId" = public.current_org_id())',
      t
    );
  END LOOP;
END$$;

-- =============================================================================
-- ExchangeRate: tabla global de referencia (FX rates BCR / manual).
--   SELECT abierto a cualquier rol autenticado.
--   INSERT/UPDATE/DELETE sólo via service_role (sin policy = bloqueado para
--   non-superuser).
-- =============================================================================
DROP POLICY IF EXISTS fx_select_all ON public."ExchangeRate";
CREATE POLICY fx_select_all ON public."ExchangeRate"
  FOR SELECT
  USING (true);
