-- =============================================================================
-- §13 Surgery — 30b: resto del hardening (ejecutar DESPUÉS de 30a)
--
-- Requiere que el enum SurgeryCaseStatus ya tenga el valor 'POST_OP'
-- (lo añade el script 30a, que debe haber commiteado primero).
--
-- Idempotente.
-- =============================================================================

-- 1. Crear AnesthesiaType si no existe ----------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AnesthesiaType') THEN
    CREATE TYPE public."AnesthesiaType" AS ENUM ('GENERAL','REGIONAL','LOCAL','SEDATION','NONE');
  END IF;
END $$;

-- 2. Columnas nuevas en SurgeryCase -------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='SurgeryCase' AND column_name='signInAt'
  ) THEN
    ALTER TABLE public."SurgeryCase"
      ADD COLUMN "signInAt"   TIMESTAMPTZ,
      ADD COLUMN "signInById" UUID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='SurgeryCase' AND column_name='signOutAt'
  ) THEN
    ALTER TABLE public."SurgeryCase"
      ADD COLUMN "signOutAt"   TIMESTAMPTZ,
      ADD COLUMN "signOutById" UUID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='SurgeryCase' AND column_name='anesthesiaType'
  ) THEN
    ALTER TABLE public."SurgeryCase"
      ADD COLUMN "anesthesiaType"    public."AnesthesiaType",
      ADD COLUMN "anesthesiaStartAt" TIMESTAMPTZ,
      ADD COLUMN "anesthesiaEndAt"   TIMESTAMPTZ;
  END IF;
END $$;

-- 3. CHECK constraint — anesthesia end > start --------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='surgery_case_anesthesia_times_chk') THEN
    ALTER TABLE public."SurgeryCase"
      ADD CONSTRAINT surgery_case_anesthesia_times_chk
      CHECK (
        "anesthesiaEndAt" IS NULL
        OR "anesthesiaStartAt" IS NULL
        OR "anesthesiaEndAt" > "anesthesiaStartAt"
      );
  END IF;
END $$;

-- 4. Índices de soporte (usan POST_OP — requiere 30a commit) ------------------

CREATE INDEX IF NOT EXISTS ix_surgery_case_or_conflict
  ON public."SurgeryCase" ("operatingRoomId", "scheduledStart", "scheduledEnd")
  WHERE "deletedAt" IS NULL
    AND status NOT IN ('CANCELLED', 'POSTPONED', 'COMPLETED');

CREATE INDEX IF NOT EXISTS ix_surgery_case_sign_in_pending
  ON public."SurgeryCase" ("organizationId", "scheduledStart")
  WHERE "signInAt" IS NULL AND "deletedAt" IS NULL AND status = 'SCHEDULED';

CREATE INDEX IF NOT EXISTS ix_surgery_case_post_op
  ON public."SurgeryCase" ("organizationId", "actualEnd")
  WHERE status = 'POST_OP' AND "deletedAt" IS NULL;

-- 5. Trigger — state machine SurgeryCase.status -------------------------------

CREATE OR REPLACE FUNCTION public.fn_validate_surgery_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  v_allowed :=
       (OLD.status = 'SCHEDULED'   AND NEW.status IN ('CONFIRMED','IN_PROGRESS','CANCELLED','POSTPONED'))
    OR (OLD.status = 'CONFIRMED'   AND NEW.status IN ('IN_PROGRESS','CANCELLED','POSTPONED'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('POST_OP','CANCELLED'))
    OR (OLD.status = 'POST_OP'     AND NEW.status IN ('COMPLETED','CANCELLED'))
    OR (OLD.status = 'POSTPONED'   AND NEW.status IN ('SCHEDULED','CONFIRMED','CANCELLED'));
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transición inválida de SurgeryCase: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_surgery_status_transition ON public."SurgeryCase";
CREATE TRIGGER tr_surgery_status_transition
  BEFORE UPDATE ON public."SurgeryCase"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_surgery_status_transition();

-- 6. Trigger — WHO checklist gate ---------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_surgery_who_checklist_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('SCHEDULED','CONFIRMED')
     AND NEW.status = 'IN_PROGRESS'
  THEN
    IF NEW."signInAt" IS NULL THEN
      RAISE EXCEPTION 'WHO checklist: Sign In requerido antes de iniciar cirugía.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."timeOutAt" IS NULL THEN
      RAISE EXCEPTION 'WHO checklist: Time Out requerido antes de iniciar cirugía.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'IN_PROGRESS'
     AND NEW.status = 'POST_OP'
  THEN
    IF NEW."signOutAt" IS NULL THEN
      RAISE EXCEPTION 'WHO checklist: Sign Out requerido antes de pasar a POST_OP.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_surgery_who_checklist ON public."SurgeryCase";
CREATE TRIGGER tr_surgery_who_checklist
  BEFORE UPDATE ON public."SurgeryCase"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_surgery_who_checklist_gate();
