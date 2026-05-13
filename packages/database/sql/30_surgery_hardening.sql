-- =============================================================================
-- §13 Surgery — Hardening Layer 1 (Beta.6, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento manual — NO prod auto)
-- Estado: NO ejecutado en prod. Documentado para aplicación post-cierre Beta.6.
--
-- Cambios:
--   1. Columnas WHO Surgical Safety Checklist (Sign In / Time Out / Sign Out)
--      en surgery_case. Columnas AnesthesiaType + anesthesia start/end.
--   2. Nuevo valor POST_OP al enum surgery_case_status.
--   3. Índices de soporte para OR conflict detection y queries de checklist.
--   4. Trigger de state machine: valida transiciones en surgery_case.status.
--   5. Trigger de time-out gate: bloquea SCHEDULED → IN_PROGRESS si faltan
--      sign_in_at o time_out_at (defensa en profundidad vs router).
--   6. CHECK constraint: anesthesia_end_at > anesthesia_start_at.
--
-- Convención: TODO el SQL es idempotente (IF NOT EXISTS / OR REPLACE / DROP
-- TRIGGER IF EXISTS) para soportar re-ejecución sin error.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum — añadir POST_OP a surgery_case_status
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'POST_OP'
      AND enumtypid = (
        SELECT oid FROM pg_type WHERE typname = 'surgerycasestatus'
      )
  ) THEN
    ALTER TYPE public."SurgeryCaseStatus" ADD VALUE 'POST_OP' BEFORE 'COMPLETED';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Enum — crear AnesthesiaType si no existe
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'AnesthesiaType'
  ) THEN
    CREATE TYPE public."AnesthesiaType" AS ENUM (
      'GENERAL', 'REGIONAL', 'LOCAL', 'SEDATION', 'NONE'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Columnas nuevas en surgery_case
-- -----------------------------------------------------------------------------

-- WHO Sign In
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'surgery_case'
      AND column_name = 'sign_in_at'
  ) THEN
    ALTER TABLE public.surgery_case
      ADD COLUMN sign_in_at   TIMESTAMPTZ,
      ADD COLUMN sign_in_by_id UUID;
  END IF;
END $$;

-- WHO Sign Out
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'surgery_case'
      AND column_name = 'sign_out_at'
  ) THEN
    ALTER TABLE public.surgery_case
      ADD COLUMN sign_out_at   TIMESTAMPTZ,
      ADD COLUMN sign_out_by_id UUID;
  END IF;
END $$;

-- Anesthesia tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'surgery_case'
      AND column_name = 'anesthesia_type'
  ) THEN
    ALTER TABLE public.surgery_case
      ADD COLUMN anesthesia_type     public."AnesthesiaType",
      ADD COLUMN anesthesia_start_at TIMESTAMPTZ,
      ADD COLUMN anesthesia_end_at   TIMESTAMPTZ;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. CHECK constraint — anesthesia end > start
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'surgery_case_anesthesia_times_chk'
  ) THEN
    ALTER TABLE public.surgery_case
      ADD CONSTRAINT surgery_case_anesthesia_times_chk
      CHECK (
        anesthesia_end_at IS NULL
        OR anesthesia_start_at IS NULL
        OR anesthesia_end_at > anesthesia_start_at
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Índices de soporte
-- -----------------------------------------------------------------------------

-- OR conflict detection: busca solapamientos en quirófanos activos.
-- Query pattern: WHERE operating_room_id = $1 AND status IN (...) AND
--                  scheduled_start < $end AND scheduled_end > $start
CREATE INDEX IF NOT EXISTS ix_surgery_case_or_conflict
  ON public.surgery_case (operating_room_id, scheduled_start, scheduled_end)
  WHERE deleted_at IS NULL
    AND status NOT IN ('CANCELLED', 'POSTPONED', 'COMPLETED');

-- Query: "WHO checklist pendiente" — casos sin sign_in ordenados por start.
CREATE INDEX IF NOT EXISTS ix_surgery_case_sign_in_pending
  ON public.surgery_case (organization_id, scheduled_start)
  WHERE sign_in_at IS NULL AND deleted_at IS NULL AND status = 'SCHEDULED';

-- Query: "casos POST_OP activos por organización".
CREATE INDEX IF NOT EXISTS ix_surgery_case_post_op
  ON public.surgery_case (organization_id, actual_end)
  WHERE status = 'POST_OP' AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 6. Trigger — state machine surgery_case.status
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_validate_surgery_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_allowed BOOLEAN := FALSE;
BEGIN
  -- INSERT: estado inicial SCHEDULED siempre permitido.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Si status no cambia, pasar (update de otros campos).
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Transiciones válidas de la state machine.
  v_allowed :=
    -- Forward path
    (OLD.status = 'SCHEDULED'   AND NEW.status IN ('CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'POSTPONED'))
    OR (OLD.status = 'CONFIRMED'   AND NEW.status IN ('IN_PROGRESS', 'CANCELLED', 'POSTPONED'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('POST_OP', 'CANCELLED'))
    OR (OLD.status = 'POST_OP'     AND NEW.status IN ('COMPLETED', 'CANCELLED'))
    -- POSTPONED puede re-schedularse (SCHEDULED) o cancelarse
    OR (OLD.status = 'POSTPONED'   AND NEW.status IN ('SCHEDULED', 'CONFIRMED', 'CANCELLED'));

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transición inválida de SurgeryCase: % → %',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_surgery_status_transition ON public.surgery_case;
CREATE TRIGGER tr_surgery_status_transition
  BEFORE UPDATE ON public.surgery_case
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_surgery_status_transition();

-- -----------------------------------------------------------------------------
-- 7. Trigger — WHO checklist gate: bloquea SCHEDULED/CONFIRMED → IN_PROGRESS
--    si sign_in_at IS NULL o time_out_at IS NULL
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_surgery_who_checklist_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Solo actúa cuando se transita a IN_PROGRESS.
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('SCHEDULED', 'CONFIRMED')
     AND NEW.status = 'IN_PROGRESS'
  THEN
    IF NEW.sign_in_at IS NULL THEN
      RAISE EXCEPTION 'WHO checklist: Sign In requerido antes de iniciar cirugía.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.time_out_at IS NULL THEN
      RAISE EXCEPTION 'WHO checklist: Time Out requerido antes de iniciar cirugía.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Bloquea IN_PROGRESS → POST_OP si sign_out_at IS NULL.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'IN_PROGRESS'
     AND NEW.status = 'POST_OP'
  THEN
    IF NEW.sign_out_at IS NULL THEN
      RAISE EXCEPTION 'WHO checklist: Sign Out requerido antes de pasar a POST_OP.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_surgery_who_checklist ON public.surgery_case;
CREATE TRIGGER tr_surgery_who_checklist
  BEFORE UPDATE ON public.surgery_case
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_surgery_who_checklist_gate();

-- -----------------------------------------------------------------------------
-- 8. Verificación post-aplicación
-- -----------------------------------------------------------------------------

-- SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'SurgeryCaseStatus');
-- -- Debe incluir POST_OP

-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'surgery_case' AND column_name IN
--   ('sign_in_at','sign_in_by_id','sign_out_at','sign_out_by_id',
--    'anesthesia_type','anesthesia_start_at','anesthesia_end_at');
-- -- Debe retornar 7 filas

-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.surgery_case'::regclass;
-- -- Debe incluir tr_surgery_status_transition y tr_surgery_who_checklist

-- SELECT conname FROM pg_constraint WHERE conname = 'surgery_case_anesthesia_times_chk';
-- -- Debe retornar 1 fila
-- =============================================================================
