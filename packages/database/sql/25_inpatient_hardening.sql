-- =============================================================================
-- §11 Inpatient — Hardening Layer 1 (Beta.1, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento Edwin manual)
-- Estado: NO ejecutado en prod. Documentado para aplicación post-cierre Bloque 1.
--
-- Cambios:
--   1. Índices adicionales para queries de hardening (vital alerts, state machine,
--      bed assignment lookup).
--   2. Constraint CHECK en kardex.entry para garantizar texto no-vacío.
--   3. Trigger para validar transiciones de InpatientStatus a nivel DB
--      (defensa en profundidad además del router).
--
-- Convención: TODO el SQL es idempotente (CREATE INDEX IF NOT EXISTS, DROP
-- TRIGGER IF EXISTS, etc.) para soportar re-ejecución sin error.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Índices adicionales (perf de queries de hardening)
-- -----------------------------------------------------------------------------

-- Query: "vitals últimos N min con alertas" — vitales ordenados por timestamp
-- inverso con valores fuera de rango. Cubre los queries que el cliente eMAR/
-- bedside dashboards hacen al cargar.
CREATE INDEX IF NOT EXISTS ix_inpatient_vitals_admission_recordedAt_desc
  ON public.inpatient_vitals (admission_id, recorded_at DESC);

-- Query: "kardex del turno actual" — entrada por turno ordenado por timestamp.
CREATE INDEX IF NOT EXISTS ix_inpatient_kardex_admission_shift_recordedAt
  ON public.inpatient_kardex (admission_id, shift, recorded_at DESC);

-- Query: "care plans activos del paciente" — soporta dashboard de enfermería.
CREATE INDEX IF NOT EXISTS ix_inpatient_care_plan_admission_status
  ON public.inpatient_care_plan (admission_id, status);

-- Query: "bed assignments activas por encounter" — perf del release al alta.
CREATE INDEX IF NOT EXISTS ix_bed_assignment_encounter_released_null
  ON public.bed_assignment (encounter_id)
  WHERE released_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. CHECK constraints adicionales (defensa en profundidad)
-- -----------------------------------------------------------------------------

-- Kardex.entry NO debe ser texto vacío o whitespace.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inpatient_kardex_entry_not_blank_chk'
  ) THEN
    ALTER TABLE public.inpatient_kardex
      ADD CONSTRAINT inpatient_kardex_entry_not_blank_chk
      CHECK (length(btrim(entry)) > 0);
  END IF;
END $$;

-- InpatientAdmission.reason NO debe ser texto vacío o whitespace.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inpatient_admission_reason_not_blank_chk'
  ) THEN
    ALTER TABLE public.inpatient_admission
      ADD CONSTRAINT inpatient_admission_reason_not_blank_chk
      CHECK (length(btrim(reason)) > 0);
  END IF;
END $$;

-- expectedLos si presente debe estar en rango 1..365.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inpatient_admission_expected_los_range_chk'
  ) THEN
    ALTER TABLE public.inpatient_admission
      ADD CONSTRAINT inpatient_admission_expected_los_range_chk
      CHECK (expected_los IS NULL OR (expected_los >= 1 AND expected_los <= 365));
  END IF;
END $$;

-- InpatientVitals — rangos clínicamente plausibles (lo que ya valida Zod en
-- el contracts; aquí defensa en profundidad para inserts directos al DB).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inpatient_vitals_temperature_range_chk'
  ) THEN
    ALTER TABLE public.inpatient_vitals
      ADD CONSTRAINT inpatient_vitals_temperature_range_chk
      CHECK (temperature_c IS NULL OR (temperature_c >= 25.0 AND temperature_c <= 45.0));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inpatient_vitals_heart_rate_range_chk'
  ) THEN
    ALTER TABLE public.inpatient_vitals
      ADD CONSTRAINT inpatient_vitals_heart_rate_range_chk
      CHECK (heart_rate IS NULL OR (heart_rate >= 20 AND heart_rate <= 250));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inpatient_vitals_spo2_range_chk'
  ) THEN
    ALTER TABLE public.inpatient_vitals
      ADD CONSTRAINT inpatient_vitals_spo2_range_chk
      CHECK (spo2 IS NULL OR (spo2 >= 40 AND spo2 <= 100));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Trigger de state machine InpatientAdmission.status
-- -----------------------------------------------------------------------------

-- Función trigger: valida que las transiciones de status sigan la state machine
-- documentada en packages/contracts/src/schemas/inpatient.ts.
CREATE OR REPLACE FUNCTION public.fn_validate_inpatient_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_allowed BOOLEAN := FALSE;
BEGIN
  -- En INSERT siempre se acepta el estado inicial (típicamente ACTIVE).
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Si el status no cambia, permitir (puede ser update de otros campos).
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Validar transición.
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

DROP TRIGGER IF EXISTS tr_inpatient_status_transition ON public.inpatient_admission;
CREATE TRIGGER tr_inpatient_status_transition
  BEFORE UPDATE ON public.inpatient_admission
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_inpatient_status_transition();

-- -----------------------------------------------------------------------------
-- 4. Verificación post-aplicación (revisar al ejecutar manualmente)
-- -----------------------------------------------------------------------------

-- Esperado tras ejecución:
--   SELECT COUNT(*) FROM pg_indexes WHERE indexname LIKE 'ix_inpatient%' OR indexname LIKE 'ix_bed_assignment%';
--   -- Debe retornar >= 4 (los 4 índices creados arriba; pueden existir más previos)
--
--   SELECT COUNT(*) FROM pg_constraint
--   WHERE conname IN (
--     'inpatient_kardex_entry_not_blank_chk',
--     'inpatient_admission_reason_not_blank_chk',
--     'inpatient_admission_expected_los_range_chk',
--     'inpatient_vitals_temperature_range_chk',
--     'inpatient_vitals_heart_rate_range_chk',
--     'inpatient_vitals_spo2_range_chk'
--   );
--   -- Debe retornar 6
--
--   SELECT tgname FROM pg_trigger WHERE tgname = 'tr_inpatient_status_transition';
--   -- Debe retornar la fila del trigger

-- -----------------------------------------------------------------------------
-- 5. Rollback (si fuera necesario)
-- -----------------------------------------------------------------------------

-- BEGIN;
--   DROP TRIGGER IF EXISTS tr_inpatient_status_transition ON public.inpatient_admission;
--   DROP FUNCTION IF EXISTS public.fn_validate_inpatient_status_transition();
--   ALTER TABLE public.inpatient_kardex DROP CONSTRAINT IF EXISTS inpatient_kardex_entry_not_blank_chk;
--   ALTER TABLE public.inpatient_admission DROP CONSTRAINT IF EXISTS inpatient_admission_reason_not_blank_chk;
--   ALTER TABLE public.inpatient_admission DROP CONSTRAINT IF EXISTS inpatient_admission_expected_los_range_chk;
--   ALTER TABLE public.inpatient_vitals DROP CONSTRAINT IF EXISTS inpatient_vitals_temperature_range_chk;
--   ALTER TABLE public.inpatient_vitals DROP CONSTRAINT IF EXISTS inpatient_vitals_heart_rate_range_chk;
--   ALTER TABLE public.inpatient_vitals DROP CONSTRAINT IF EXISTS inpatient_vitals_spo2_range_chk;
--   DROP INDEX IF EXISTS public.ix_inpatient_vitals_admission_recordedAt_desc;
--   DROP INDEX IF EXISTS public.ix_inpatient_kardex_admission_shift_recordedAt;
--   DROP INDEX IF EXISTS public.ix_inpatient_care_plan_admission_status;
--   DROP INDEX IF EXISTS public.ix_bed_assignment_encounter_released_null;
-- COMMIT;
