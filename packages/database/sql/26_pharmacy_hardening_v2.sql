-- =============================================================================
-- §15 Pharmacy — Hardening Layer 1 v2 (Beta.2, parche 2026-05-14)
--
-- v2: corrige naming PascalCase ("Drug", "MedicationDispense", "Prescription",
-- "PrescriptionItem") y columnas camelCase quoted ("atcCode", "batchNumber",
-- "expiryDate", "organizationId", "prescribedAt", "strengthValue",
-- "durationDays"). El v1 (26_pharmacy_hardening.sql) usaba snake_case.
--
-- Idempotente.
-- =============================================================================

-- 1. Índices adicionales ------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_drug_atc_code
  ON public."Drug" ("atcCode")
  WHERE "atcCode" IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_medication_dispense_batch_expiry
  ON public."MedicationDispense" ("batchNumber", "expiryDate")
  WHERE "batchNumber" IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_prescription_org_status_prescribed
  ON public."Prescription" ("organizationId", status, "prescribedAt" DESC);

-- 2. CHECK constraints --------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'medication_dispense_quantity_positive_chk') THEN
    ALTER TABLE public."MedicationDispense"
      ADD CONSTRAINT medication_dispense_quantity_positive_chk
      CHECK (quantity > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drug_strength_value_positive_chk') THEN
    ALTER TABLE public."Drug"
      ADD CONSTRAINT drug_strength_value_positive_chk
      CHECK ("strengthValue" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prescription_item_duration_days_range_chk') THEN
    ALTER TABLE public."PrescriptionItem"
      ADD CONSTRAINT prescription_item_duration_days_range_chk
      CHECK ("durationDays" IS NULL OR ("durationDays" >= 1 AND "durationDays" <= 365));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drug_atc_code_format_chk') THEN
    ALTER TABLE public."Drug"
      ADD CONSTRAINT drug_atc_code_format_chk
      CHECK (
        "atcCode" IS NULL
        OR (length("atcCode") BETWEEN 1 AND 10 AND "atcCode" ~ '^[A-Z0-9]+$')
      );
  END IF;
END $$;

-- 3. Trigger state machine Prescription.status --------------------------------

CREATE OR REPLACE FUNCTION public.fn_validate_prescription_status_transition()
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

DROP TRIGGER IF EXISTS tr_prescription_status_transition ON public."Prescription";
CREATE TRIGGER tr_prescription_status_transition
  BEFORE UPDATE ON public."Prescription"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_prescription_status_transition();
