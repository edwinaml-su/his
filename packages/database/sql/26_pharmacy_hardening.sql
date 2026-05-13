-- =============================================================================
-- §15 Pharmacy — Hardening Layer 1 (Beta.2, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento Edwin manual)
-- Estado: NO ejecutado en prod. Documentado para aplicación post-cierre Bloque 1.
--
-- Cambios:
--   1. Índices adicionales para queries de hardening (FEFO lookup, interaction
--      precheck por atc, dispense audit).
--   2. Constraint CHECK en quantity > 0 y prevent insert con expiryDate pasada.
--   3. Trigger para validar transiciones de PrescriptionStatus a nivel DB.
--
-- Convención: SQL idempotente con DO $$ ... $$ guards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Índices adicionales
-- -----------------------------------------------------------------------------

-- Query: "buscar drug por atcCode" — usado por interaction precheck.
CREATE INDEX IF NOT EXISTS ix_drug_atc_code
  ON public.drug (atc_code)
  WHERE atc_code IS NOT NULL;

-- Query: "medication dispenses por lote para auditoría FEFO".
CREATE INDEX IF NOT EXISTS ix_medication_dispense_batch_expiry
  ON public.medication_dispense (batch_number, expiry_date)
  WHERE batch_number IS NOT NULL;

-- Query: "prescriptions por status + organizationId + prescribedAt" para
-- worklist farmacéutico.
CREATE INDEX IF NOT EXISTS ix_prescription_org_status_prescribedAt
  ON public.prescription (organization_id, status, prescribed_at DESC);

-- -----------------------------------------------------------------------------
-- 2. CHECK constraints
-- -----------------------------------------------------------------------------

-- MedicationDispense.quantity > 0 (defensa en profundidad).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medication_dispense_quantity_positive_chk'
  ) THEN
    ALTER TABLE public.medication_dispense
      ADD CONSTRAINT medication_dispense_quantity_positive_chk
      CHECK (quantity > 0);
  END IF;
END $$;

-- Drug.strengthValue > 0.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drug_strength_value_positive_chk'
  ) THEN
    ALTER TABLE public.drug
      ADD CONSTRAINT drug_strength_value_positive_chk
      CHECK (strength_value > 0);
  END IF;
END $$;

-- PrescriptionItem.durationDays si presente entre 1..365.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prescription_item_duration_days_range_chk'
  ) THEN
    ALTER TABLE public.prescription_item
      ADD CONSTRAINT prescription_item_duration_days_range_chk
      CHECK (duration_days IS NULL OR (duration_days >= 1 AND duration_days <= 365));
  END IF;
END $$;

-- Drug.atc_code formato (4-7 chars alfanuméricos uppercase).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drug_atc_code_format_chk'
  ) THEN
    ALTER TABLE public.drug
      ADD CONSTRAINT drug_atc_code_format_chk
      CHECK (
        atc_code IS NULL
        OR (
          length(atc_code) BETWEEN 1 AND 10
          AND atc_code ~ '^[A-Z0-9]+$'
        )
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Trigger de state machine PrescriptionStatus
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_validate_prescription_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_allowed BOOLEAN := FALSE;
BEGIN
  -- En INSERT siempre se acepta el estado inicial (típicamente DRAFT).
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Si el status no cambia, permitir (puede ser update de otros campos).
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Reglas de transición (espejo de canTransitionPrescription en contracts).
  v_allowed := (OLD.status = 'DRAFT' AND NEW.status IN ('SIGNED', 'CANCELLED'))
            OR (OLD.status = 'SIGNED' AND NEW.status IN ('DISPENSED', 'PARTIALLY_DISPENSED', 'CANCELLED', 'EXPIRED'))
            OR (OLD.status = 'PARTIALLY_DISPENSED' AND NEW.status IN ('DISPENSED', 'CANCELLED', 'EXPIRED'));

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transición inválida de Prescription.status: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_prescription_status_transition ON public.prescription;
CREATE TRIGGER tr_prescription_status_transition
  BEFORE UPDATE ON public.prescription
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_prescription_status_transition();

-- -----------------------------------------------------------------------------
-- 4. Verificación post-aplicación
-- -----------------------------------------------------------------------------

-- Esperado tras ejecución:
--   SELECT COUNT(*) FROM pg_indexes
--   WHERE indexname IN (
--     'ix_drug_atc_code',
--     'ix_medication_dispense_batch_expiry',
--     'ix_prescription_org_status_prescribedAt'
--   );  -- = 3
--
--   SELECT COUNT(*) FROM pg_constraint
--   WHERE conname IN (
--     'medication_dispense_quantity_positive_chk',
--     'drug_strength_value_positive_chk',
--     'prescription_item_duration_days_range_chk',
--     'drug_atc_code_format_chk'
--   );  -- = 4
--
--   SELECT tgname FROM pg_trigger WHERE tgname = 'tr_prescription_status_transition';
--   -- Debe retornar 1 fila

-- -----------------------------------------------------------------------------
-- 5. Rollback (si fuera necesario)
-- -----------------------------------------------------------------------------

-- BEGIN;
--   DROP TRIGGER IF EXISTS tr_prescription_status_transition ON public.prescription;
--   DROP FUNCTION IF EXISTS public.fn_validate_prescription_status_transition();
--   ALTER TABLE public.medication_dispense DROP CONSTRAINT IF EXISTS medication_dispense_quantity_positive_chk;
--   ALTER TABLE public.drug DROP CONSTRAINT IF EXISTS drug_strength_value_positive_chk;
--   ALTER TABLE public.prescription_item DROP CONSTRAINT IF EXISTS prescription_item_duration_days_range_chk;
--   ALTER TABLE public.drug DROP CONSTRAINT IF EXISTS drug_atc_code_format_chk;
--   DROP INDEX IF EXISTS public.ix_drug_atc_code;
--   DROP INDEX IF EXISTS public.ix_medication_dispense_batch_expiry;
--   DROP INDEX IF EXISTS public.ix_prescription_org_status_prescribedAt;
-- COMMIT;
