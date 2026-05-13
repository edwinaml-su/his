-- =============================================================================
-- §25 Insurance Agreements — Hardening Layer 1 (Beta.14, 2026-05-13)
--
-- Owner : @DBA (revisar) + @SRE (aplicar en mantenimiento Edwin manual)
-- Estado: NO ejecutado en prod. Documentado para aplicación post-G8.
--
-- Cambios:
--   1. Enum PENDING añadido a AuthorizationStatus.
--   2. Columna coveredProcedures JSONB en InsurancePlan.
--   3. CHECK constraint: PatientCoverage.validFrom <= validTo (si set).
--   4. Trigger audit trail: BLOCK UPDATE/DELETE en AuthorizationRequest
--      cuando status != PENDING y status != REQUESTED (append-only post-transition).
--   5. Trigger state machine: sólo permite transiciones válidas en
--      AuthorizationRequest.status.
--   6. CHECK constraint: AuthorizationRequest APPROVED requiere denial_reason NULL
--      y DENIED requiere denial_reason NOT NULL.
--   7. Índices para queries de hardening.
--
-- Convención: TODO idempotente (IF NOT EXISTS, DROP ... IF EXISTS, DO dollar dollar ... dollar dollar).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Añadir PENDING al tipo enum AuthorizationStatus
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AuthorizationStatus'
      AND e.enumlabel = 'PENDING'
  ) THEN
    ALTER TYPE public."AuthorizationStatus" ADD VALUE 'PENDING' BEFORE 'REQUESTED';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Añadir coveredProcedures JSONB a InsurancePlan (idempotente)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'InsurancePlan'
      AND column_name  = 'coveredProcedures'
  ) THEN
    ALTER TABLE public."InsurancePlan"
      ADD COLUMN "coveredProcedures" jsonb NULL;
    COMMENT ON COLUMN public."InsurancePlan"."coveredProcedures" IS
      'b14 JSONB array: [{"code": "MRI", "maxCoverage": 1500.00, "description": "..."}]';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. CHECK constraint: PatientCoverage validFrom <= validTo
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."PatientCoverage"'::regclass
      AND conname   = 'chk_patient_coverage_valid_range'
  ) THEN
    ALTER TABLE public."PatientCoverage"
      ADD CONSTRAINT chk_patient_coverage_valid_range
      CHECK ("validTo" IS NULL OR "validTo" > "validFrom");
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. CHECK constraints: denial_reason business rules on AuthorizationRequest
--    (defence-in-depth - router also enforces these).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  -- DENIED must have denialReason.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."AuthorizationRequest"'::regclass
      AND conname   = 'chk_auth_denied_requires_reason'
  ) THEN
    ALTER TABLE public."AuthorizationRequest"
      ADD CONSTRAINT chk_auth_denied_requires_reason
      CHECK (
        status <> 'DENIED'
        OR ("denialReason" IS NOT NULL AND length(trim("denialReason")) > 0)
      );
  END IF;

  -- APPROVED must NOT have denialReason.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."AuthorizationRequest"'::regclass
      AND conname   = 'chk_auth_approved_no_reason'
  ) THEN
    ALTER TABLE public."AuthorizationRequest"
      ADD CONSTRAINT chk_auth_approved_no_reason
      CHECK (
        status <> 'APPROVED'
        OR "denialReason" IS NULL
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Trigger: state machine — only valid transitions allowed
--    PENDING | REQUESTED -> APPROVED | PARTIAL | DENIED | EXPIRED
--    Terminal states (APPROVED, DENIED, EXPIRED, CANCELLED) -> no further changes
--    (except service_role bypass for administrative corrections).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_auth_request_state_machine()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_open_states text[] := ARRAY['PENDING', 'REQUESTED'];
  v_terminal_states text[] := ARRAY['APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED'];
BEGIN
  -- Bypass for service_role (administrative corrections).
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Block if old status is terminal (append-only audit trail).
  IF OLD.status = ANY(v_terminal_states) THEN
    RAISE EXCEPTION
      'auth_request_immutable: status % is terminal; record id=% cannot be modified.',
      OLD.status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- Block transitions from open state to invalid target.
  IF OLD.status = ANY(v_open_states)
     AND NEW.status NOT IN ('APPROVED', 'PARTIAL', 'DENIED', 'EXPIRED', 'CANCELLED')
     AND OLD.status <> NEW.status
  THEN
    RAISE EXCEPTION
      'auth_request_invalid_transition: % to % is not allowed for id=%.',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_request_state_machine ON public."AuthorizationRequest";
CREATE TRIGGER trg_auth_request_state_machine
  BEFORE UPDATE ON public."AuthorizationRequest"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auth_request_state_machine();

-- -----------------------------------------------------------------------------
-- 6. Trigger: BLOCK DELETE on AuthorizationRequest (append-only audit trail)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_auth_request_no_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'auth_request_no_delete: AuthorizationRequest records are immutable (id=%).',
    OLD.id
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_request_no_delete ON public."AuthorizationRequest";
CREATE TRIGGER trg_auth_request_no_delete
  BEFORE DELETE ON public."AuthorizationRequest"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auth_request_no_delete();

-- -----------------------------------------------------------------------------
-- 7. Indices de rendimiento para queries de hardening
-- -----------------------------------------------------------------------------

-- getExpiringAuthorizations: APPROVED + validTo lookup ordered by validTo ASC.
CREATE INDEX IF NOT EXISTS ix_auth_request_status_valid_to
  ON public."AuthorizationRequest" (status, "validTo" ASC)
  WHERE status = 'APPROVED' AND "validTo" IS NOT NULL;

-- checkCoverage: plan lookup by id + active.
CREATE INDEX IF NOT EXISTS ix_insurance_plan_id_active
  ON public."InsurancePlan" (id)
  WHERE active = true;

-- organizationId + status composite for expiry queries.
CREATE INDEX IF NOT EXISTS ix_auth_request_org_status_validto
  ON public."AuthorizationRequest" ("organizationId", status, "validTo");
