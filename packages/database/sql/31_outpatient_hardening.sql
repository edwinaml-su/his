-- =============================================================================
-- §10 Outpatient — Hardening Layer 1 (Beta.7, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento Edwin manual)
-- Estado: NO ejecutado en prod. Documentado para aplicación post-cierre Bloque 2.
--
-- Cambios:
--   1. Enum ReasonCategory (ROUTINE/FOLLOWUP/ACUTE/PREVENTIVE/CHRONIC/OTHER).
--   2. Columna reasonCategory en OutpatientAppointment y OutpatientConsultation.
--   3. Bump VarChar(400) → VarChar(500) para reason/reasonOfVisit.
--   4. Trigger: bloquea INSERT en OutpatientConsultation si appointment vinculado
--      no está en CHECKED_IN/COMPLETED (defensa en profundidad vs. router).
--   5. Trigger: valida transiciones de AppointmentStatus a nivel DB.
--   6. Índice adicional (providerId, scheduledAt, status) para double-booking query.
--
-- Convención: TODO el SQL es idempotente para soportar re-ejecución sin error.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ReasonCategory enum
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReasonCategory' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
    CREATE TYPE public."ReasonCategory" AS ENUM (
      'ROUTINE', 'FOLLOWUP', 'ACUTE', 'PREVENTIVE', 'CHRONIC', 'OTHER'
    );
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. Columnas nuevas en OutpatientAppointment
-- -----------------------------------------------------------------------------

-- reason: VarChar(400) → VarChar(500)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OutpatientAppointment'
      AND column_name = 'reason'
      AND character_maximum_length = 400
  ) THEN
    ALTER TABLE public."OutpatientAppointment"
      ALTER COLUMN reason TYPE VARCHAR(500);
  END IF;
END$$;

-- reasonCategory column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OutpatientAppointment'
      AND column_name = 'reasonCategory'
  ) THEN
    ALTER TABLE public."OutpatientAppointment"
      ADD COLUMN "reasonCategory" public."ReasonCategory";
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. Columnas nuevas en OutpatientConsultation
-- -----------------------------------------------------------------------------

-- reasonOfVisit: VarChar(400) → VarChar(500)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OutpatientConsultation'
      AND column_name = 'reasonOfVisit'
      AND character_maximum_length = 400
  ) THEN
    ALTER TABLE public."OutpatientConsultation"
      ALTER COLUMN "reasonOfVisit" TYPE VARCHAR(500);
  END IF;
END$$;

-- reasonCategory column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OutpatientConsultation'
      AND column_name = 'reasonCategory'
  ) THEN
    ALTER TABLE public."OutpatientConsultation"
      ADD COLUMN "reasonCategory" public."ReasonCategory";
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 4. Trigger: bloquea INSERT en OutpatientConsultation si appointmentId vinculado
--    no está en CHECKED_IN/COMPLETED. Walk-ins (appointmentId IS NULL) pasan.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_outpatient_consultation_appt_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NEW."appointmentId" IS NULL THEN
    -- Walk-in: no appointment link required
    RETURN NEW;
  END IF;

  SELECT status INTO v_status
  FROM public."OutpatientAppointment"
  WHERE id = NEW."appointmentId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita no encontrada: %', NEW."appointmentId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_status NOT IN ('CHECKED_IN', 'COMPLETED') THEN
    RAISE EXCEPTION
      'No se puede crear la consulta: la cita debe estar en CHECKED_IN o COMPLETED. Estado actual: %',
      v_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outpatient_consultation_appt_status
  ON public."OutpatientConsultation";

CREATE TRIGGER trg_outpatient_consultation_appt_status
  BEFORE INSERT ON public."OutpatientConsultation"
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_outpatient_consultation_appt_status();

-- -----------------------------------------------------------------------------
-- 5. Trigger: valida transiciones de AppointmentStatus a nivel DB.
--    Defensa en profundidad vs. la validación del router.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_outpatient_appointment_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only validate on status change
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Terminal states: no transitions allowed
  IF OLD.status IN ('NO_SHOW', 'COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION
      'Estado % es terminal, no se puede transicionar a %.',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- SCHEDULED can go to CONFIRMED, CHECKED_IN, CANCELLED, NO_SHOW
  IF OLD.status = 'SCHEDULED' AND NEW.status NOT IN ('CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW') THEN
    RAISE EXCEPTION
      'Transición inválida: SCHEDULED → %. Permitidas: CONFIRMED, CHECKED_IN, CANCELLED, NO_SHOW.',
      NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- CONFIRMED can go to CHECKED_IN, CANCELLED, NO_SHOW
  IF OLD.status = 'CONFIRMED' AND NEW.status NOT IN ('CHECKED_IN', 'CANCELLED', 'NO_SHOW') THEN
    RAISE EXCEPTION
      'Transición inválida: CONFIRMED → %. Permitidas: CHECKED_IN, CANCELLED, NO_SHOW.',
      NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- CHECKED_IN can go to COMPLETED, CANCELLED
  IF OLD.status = 'CHECKED_IN' AND NEW.status NOT IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION
      'Transición inválida: CHECKED_IN → %. Permitidas: COMPLETED, CANCELLED.',
      NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outpatient_appointment_status_transition
  ON public."OutpatientAppointment";

CREATE TRIGGER trg_outpatient_appointment_status_transition
  BEFORE UPDATE ON public."OutpatientAppointment"
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_outpatient_appointment_status_transition();

-- -----------------------------------------------------------------------------
-- 6. Índice adicional para double-booking detection query
--    (providerId, scheduledAt, status) — excluye CANCELLED via partial index.
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_outpatient_appt_provider_scheduledat_active
  ON public."OutpatientAppointment" ("providerId", "scheduledAt")
  WHERE status <> 'CANCELLED' AND "deletedAt" IS NULL;

-- =============================================================================
-- FIN: 31_outpatient_hardening.sql
-- =============================================================================
