-- =============================================================================
-- F2-S7 GS1 Bedside | StaffGsrn — GSRN del personal clínico
-- Sprint F2-S7, Proceso E
--
-- Crea la tabla "StaffGsrn" con:
--   - RLS por organizationId
--   - UNIQUE constraints: userId (1 activo) + gsrn (global)
--   - Audit trigger
--   - State machine ACTIVE → REVOKED (terminal)
--   - Constraint: solo 1 GSRN ACTIVE por userId
--
-- Idempotente.
-- =============================================================================

-- 1. Enum StaffGsrnStatus ----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffGsrnStatus') THEN
    CREATE TYPE public."StaffGsrnStatus" AS ENUM (
      'ACTIVE',
      'REVOKED'
    );
  END IF;
END $$;

-- 2. Tabla StaffGsrn ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."StaffGsrn" (
  "id"              uuid        NOT NULL DEFAULT gen_random_uuid(),
  "organizationId"  uuid        NOT NULL,
  -- userId UNIQUE garantiza 1:1 Prisma; a nivel BD permite histórico revocado
  -- con el partial unique index abajo.
  "userId"          uuid        NOT NULL,
  -- GSRN GS1: 18 dígitos numéricos. Globalmente único.
  "gsrn"            varchar(18) NOT NULL,
  -- Contenido DataMatrix para impresión de credencial
  "badgeDataMatrix" varchar(500),
  "status"          public."StaffGsrnStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "revokedAt"       timestamptz,
  CONSTRAINT "StaffGsrn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffGsrn_gsrn_unique" UNIQUE ("gsrn"),
  CONSTRAINT "StaffGsrn_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE RESTRICT,
  CONSTRAINT "StaffGsrn_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE RESTRICT,
  CONSTRAINT "staff_gsrn_format_chk"
    CHECK ("gsrn" ~ '^\d{18}$'),
  CONSTRAINT "staff_gsrn_revoked_at_chk"
    CHECK (
      ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
      OR ("status" = 'ACTIVE' AND "revokedAt" IS NULL)
    )
);

-- 3. Partial unique: un solo GSRN ACTIVE por userId ---------------------------
-- Permite histórico revocado. Prisma @unique apunta al GSRN natural, este
-- unique parcial lo cubre a nivel userId+status.
CREATE UNIQUE INDEX IF NOT EXISTS ix_staff_gsrn_user_active_unique
  ON public."StaffGsrn" ("userId")
  WHERE "status" = 'ACTIVE';

-- 4. Índices adicionales ------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_staff_gsrn_org_status
  ON public."StaffGsrn" ("organizationId", "status");

CREATE INDEX IF NOT EXISTS ix_staff_gsrn_gsrn
  ON public."StaffGsrn" ("gsrn");

-- 5. State machine ACTIVE → REVOKED (terminal) --------------------------------
CREATE OR REPLACE FUNCTION public.fn_validate_staff_gsrn_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  -- La única transición válida es ACTIVE → REVOKED.
  IF NOT (OLD.status = 'ACTIVE' AND NEW.status = 'REVOKED') THEN
    RAISE EXCEPTION 'Transición inválida StaffGsrn.status: % → %',
      OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- Fuerza revokedAt al momento de la revocación si no viene.
  IF NEW."revokedAt" IS NULL THEN
    NEW."revokedAt" := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_staff_gsrn_status_transition ON public."StaffGsrn";
CREATE TRIGGER tr_staff_gsrn_status_transition
  BEFORE UPDATE ON public."StaffGsrn"
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_staff_gsrn_status_transition();

-- 6. Audit trigger (hash chain — credencial identificativa de personal) -------
DROP TRIGGER IF EXISTS tr_audit_staff_gsrn ON public."StaffGsrn";
CREATE TRIGGER tr_audit_staff_gsrn
  AFTER INSERT OR UPDATE OR DELETE ON public."StaffGsrn"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- 7. RLS ----------------------------------------------------------------------
ALTER TABLE public."StaffGsrn" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "StaffGsrn_tenant_isolation" ON public."StaffGsrn";
CREATE POLICY "StaffGsrn_tenant_isolation"
  ON public."StaffGsrn"
  FOR ALL
  TO authenticated
  USING (
    "organizationId" = nullif(
      current_setting('app.current_org_id', true), ''
    )::uuid
  )
  WITH CHECK (
    "organizationId" = nullif(
      current_setting('app.current_org_id', true), ''
    )::uuid
  );
