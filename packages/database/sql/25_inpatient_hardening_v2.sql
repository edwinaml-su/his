-- =============================================================================
-- §11 Inpatient — Hardening Layer 1 v2 (Beta.1, parche 2026-05-14)
--
-- v2: corrige naming PascalCase ("InpatientVitals", "InpatientKardex", etc.) y
-- columnas camelCase quoted ("admissionId", "recordedAt", "expectedLos",
-- "temperatureC", "heartRate", "encounterId", "releasedAt"). El archivo v1
-- (25_inpatient_hardening.sql) usaba snake_case que no existe en el schema
-- generado por Prisma — falló al pegarse en SQL Editor.
--
-- Idempotente: CREATE INDEX IF NOT EXISTS, DO $$ guards con pg_constraint
-- lookup, DROP TRIGGER IF EXISTS antes de CREATE TRIGGER.
-- =============================================================================

-- 1. Índices adicionales (perf de queries de hardening) -----------------------

CREATE INDEX IF NOT EXISTS ix_inpatient_vitals_admission_recorded_desc
  ON public."InpatientVitals" ("admissionId", "recordedAt" DESC);

CREATE INDEX IF NOT EXISTS ix_inpatient_kardex_admission_shift_recorded
  ON public."InpatientKardex" ("admissionId", shift, "recordedAt" DESC);

CREATE INDEX IF NOT EXISTS ix_inpatient_care_plan_admission_status
  ON public."InpatientCarePlan" ("admissionId", status);

CREATE INDEX IF NOT EXISTS ix_bed_assignment_encounter_released_null
  ON public."BedAssignment" ("encounterId")
  WHERE "releasedAt" IS NULL;

-- 2. CHECK constraints adicionales --------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inpatient_kardex_entry_not_blank_chk') THEN
    ALTER TABLE public."InpatientKardex"
      ADD CONSTRAINT inpatient_kardex_entry_not_blank_chk
      CHECK (length(btrim(entry)) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inpatient_admission_reason_not_blank_chk') THEN
    ALTER TABLE public."InpatientAdmission"
      ADD CONSTRAINT inpatient_admission_reason_not_blank_chk
      CHECK (length(btrim(reason)) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inpatient_admission_expected_los_range_chk') THEN
    ALTER TABLE public."InpatientAdmission"
      ADD CONSTRAINT inpatient_admission_expected_los_range_chk
      CHECK ("expectedLos" IS NULL OR ("expectedLos" >= 1 AND "expectedLos" <= 365));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inpatient_vitals_temperature_range_chk') THEN
    ALTER TABLE public."InpatientVitals"
      ADD CONSTRAINT inpatient_vitals_temperature_range_chk
      CHECK ("temperatureC" IS NULL OR ("temperatureC" >= 25.0 AND "temperatureC" <= 45.0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inpatient_vitals_heart_rate_range_chk') THEN
    ALTER TABLE public."InpatientVitals"
      ADD CONSTRAINT inpatient_vitals_heart_rate_range_chk
      CHECK ("heartRate" IS NULL OR ("heartRate" >= 20 AND "heartRate" <= 250));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inpatient_vitals_spo2_range_chk') THEN
    ALTER TABLE public."InpatientVitals"
      ADD CONSTRAINT inpatient_vitals_spo2_range_chk
      CHECK (spo2 IS NULL OR (spo2 >= 40 AND spo2 <= 100));
  END IF;
END $$;

-- 3. Trigger de state machine InpatientAdmission.status -----------------------

CREATE OR REPLACE FUNCTION public.fn_validate_inpatient_status_transition()
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
  v_allowed := (OLD.status = 'ACTIVE' AND NEW.status IN ('ON_LEAVE', 'DISCHARGED', 'TRANSFERRED_OUT'))
            OR (OLD.status = 'ON_LEAVE' AND NEW.status IN ('ACTIVE', 'DISCHARGED'));
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transición inválida de InpatientAdmission: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_inpatient_status_transition ON public."InpatientAdmission";
CREATE TRIGGER tr_inpatient_status_transition
  BEFORE UPDATE ON public."InpatientAdmission"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_inpatient_status_transition();

-- =============================================================================
-- Verificación post-apply:
--   SELECT COUNT(*) FROM pg_indexes WHERE indexname LIKE 'ix_inpatient%' OR indexname LIKE 'ix_bed_assignment%';
--   SELECT COUNT(*) FROM pg_constraint WHERE conname LIKE 'inpatient_%_chk';
--   SELECT tgname FROM pg_trigger WHERE tgname = 'tr_inpatient_status_transition';
-- =============================================================================
