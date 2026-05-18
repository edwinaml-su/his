-- =============================================================================
-- F2-S15 Stream D — Audit & RBAC Refinement
-- US.F2.7.3-5, 13, 16, 20-22
--
-- IMPORTANTE: Las migraciones 01 y 02 ya fueron aplicadas vía MCP Supabase.
-- Este archivo cubre las migraciones 03-05 pendientes.
-- Aplicar en orden con: mcp__supabase__apply_migration o SQL Editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- MIGRACIÓN 03: AuditDashboardConfig
-- US.F2.7.16 — configuración de whitelist IP + horario clínico por organización
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."AuditDashboardConfig" (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"       UUID NOT NULL,
  "ipWhitelist"          TEXT[] NOT NULL DEFAULT '{}',
  "horarioClinicoInicio" TIME NOT NULL DEFAULT '06:00',
  "horarioClinicoFin"    TIME NOT NULL DEFAULT '22:00',
  "outlierAlertEnabled"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_audit_dashboard_org
    FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON DELETE CASCADE,
  CONSTRAINT uq_audit_dashboard_org
    UNIQUE ("organizationId")
);

CREATE INDEX IF NOT EXISTS idx_audit_dashboard_org
  ON public."AuditDashboardConfig"("organizationId");

CREATE OR REPLACE FUNCTION public.fn_audit_dashboard_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_dashboard_updated_at ON public."AuditDashboardConfig";
CREATE TRIGGER trg_audit_dashboard_updated_at
  BEFORE UPDATE ON public."AuditDashboardConfig"
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_dashboard_updated_at();

ALTER TABLE public."AuditDashboardConfig" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "AuditDashboardConfig: org_isolation" ON public."AuditDashboardConfig";
CREATE POLICY "AuditDashboardConfig: org_isolation" ON public."AuditDashboardConfig"
  FOR ALL TO authenticated
  USING (
    "organizationId" = (current_setting('app.current_org_id', true))::uuid
  )
  WITH CHECK (
    "organizationId" = (current_setting('app.current_org_id', true))::uuid
  );

-- ---------------------------------------------------------------------------
-- MIGRACIÓN 04: UserAccountStatus
-- US.F2.7.20 — depuración anual usuarios inactivos
-- User ya tiene lastLoginAt. Agregar campo status.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserAccountStatus') THEN
    CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='User' AND column_name='accountStatus'
  ) THEN
    ALTER TABLE public."User"
      ADD COLUMN "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_user_account_status
  ON public."User"("accountStatus")
  WHERE "accountStatus" != 'ACTIVE';

-- ---------------------------------------------------------------------------
-- MIGRACIÓN 05: RLS notas confidenciales en ece.documento_instancia
-- US.F2.7.22 — solo médico-autor + DIR pueden leer si confidencial=true
-- ---------------------------------------------------------------------------

-- Primero añadir la columna si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ece' AND table_name='documento_instancia' AND column_name='confidencial'
  ) THEN
    ALTER TABLE ece.documento_instancia
      ADD COLUMN confidencial BOOLEAN NOT NULL DEFAULT false;
  END IF;
END;
$$;

-- Policy para lectura de documentos confidenciales
-- Solo el creador del documento o usuarios con rol DIR pueden ver los confidenciales
DROP POLICY IF EXISTS "documento_instancia: confidencial_read" ON ece.documento_instancia;
CREATE POLICY "documento_instancia: confidencial_read" ON ece.documento_instancia
  FOR SELECT TO authenticated
  USING (
    confidencial = false
    OR auth_user_id = (current_setting('app.current_user_id', true))::uuid
    OR EXISTS (
      SELECT 1
      FROM public."UserOrganizationRole" uor
      JOIN public."Role" r ON r.id = uor."roleId"
      WHERE uor."userId" = (current_setting('app.current_user_id', true))::uuid
        AND r.code IN ('DIR', 'super_admin')
        AND (uor."validTo" IS NULL OR uor."validTo" >= now())
    )
  );
