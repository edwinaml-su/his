-- =============================================================================
-- §17 LIS — Hardening Layer 1 v2 (Beta.3, parche 2026-05-14)
--
-- v2: corrige naming PascalCase + columnas camelCase quoted. Crea 2 tablas
-- NUEVAS ("LabReferenceRange", "LabReflexRule") en convención Prisma.
--
-- IMPORTANTE: las 2 tablas nuevas viven fuera del schema Prisma actual. Edwin
-- debe añadirlas a packages/database/prisma/schema.prisma en un PR posterior
-- antes de Wave 2 (reflex testing + stratification) para que Prisma client
-- las reconozca.
--
-- Idempotente.
-- =============================================================================

-- 1. Nueva tabla "LabReferenceRange" ------------------------------------------

CREATE TABLE IF NOT EXISTS public."LabReferenceRange" (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"  UUID NULL,
  "labTestId"       UUID NOT NULL,
  "minValue"        NUMERIC(18, 6) NULL,
  "maxValue"        NUMERIC(18, 6) NULL,
  "ageMinYears"     INTEGER NULL,
  "ageMaxYears"     INTEGER NULL,
  sex               VARCHAR(10) NOT NULL DEFAULT 'BOTH'
    CHECK (sex IN ('MALE', 'FEMALE', 'BOTH')),
  "criticalLow"     NUMERIC(18, 6) NULL,
  "criticalHigh"    NUMERIC(18, 6) NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lab_reference_range_test_fk
    FOREIGN KEY ("labTestId") REFERENCES public."LabTest"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_lab_reference_range_test_sex_age
  ON public."LabReferenceRange" ("labTestId", sex, "ageMinYears", "ageMaxYears")
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS ix_lab_reference_range_organization
  ON public."LabReferenceRange" ("organizationId")
  WHERE "organizationId" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_reference_range_min_lt_max_chk') THEN
    ALTER TABLE public."LabReferenceRange"
      ADD CONSTRAINT lab_reference_range_min_lt_max_chk
      CHECK ("minValue" IS NULL OR "maxValue" IS NULL OR "minValue" < "maxValue");
  END IF;
END $$;

-- 2. Nueva tabla "LabReflexRule" ----------------------------------------------

CREATE TABLE IF NOT EXISTS public."LabReflexRule" (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"    UUID NULL,
  "triggerTestId"     UUID NOT NULL,
  "reflexTestId"      UUID NOT NULL,
  "triggerCondition"  VARCHAR(20) NOT NULL
    CHECK ("triggerCondition" IN ('ABOVE', 'BELOW', 'POSITIVE', 'FLAGGED')),
  "triggerThreshold"  NUMERIC(18, 6) NULL,
  description         TEXT NULL,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lab_reflex_rule_trigger_fk
    FOREIGN KEY ("triggerTestId") REFERENCES public."LabTest"(id) ON DELETE CASCADE,
  CONSTRAINT lab_reflex_rule_reflex_fk
    FOREIGN KEY ("reflexTestId")  REFERENCES public."LabTest"(id) ON DELETE RESTRICT,
  CONSTRAINT lab_reflex_rule_self_chk
    CHECK ("triggerTestId" <> "reflexTestId")
);

CREATE INDEX IF NOT EXISTS ix_lab_reflex_rule_trigger
  ON public."LabReflexRule" ("triggerTestId")
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS ix_lab_reflex_rule_organization
  ON public."LabReflexRule" ("organizationId")
  WHERE "organizationId" IS NOT NULL;

-- 3. Índices adicionales en tablas existentes ---------------------------------

CREATE INDEX IF NOT EXISTS ix_lab_result_orderitem_resulted
  ON public."LabResult" ("orderItemId", "resultedAt" DESC);

CREATE INDEX IF NOT EXISTS ix_lab_result_flag_validated
  ON public."LabResult" (flag, "validatedAt")
  WHERE flag IN ('CRITICAL_LOW', 'CRITICAL_HIGH');

CREATE INDEX IF NOT EXISTS ix_lab_order_org_status_ordered
  ON public."LabOrder" ("organizationId", status, "orderedAt" DESC);

-- 4. CHECK constraints adicionales --------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_result_value_numeric_range_chk') THEN
    ALTER TABLE public."LabResult"
      ADD CONSTRAINT lab_result_value_numeric_range_chk
      CHECK ("valueNumeric" IS NULL OR ("valueNumeric" >= -99999 AND "valueNumeric" <= 99999));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_specimen_barcode_not_blank_chk') THEN
    ALTER TABLE public."LabSpecimen"
      ADD CONSTRAINT lab_specimen_barcode_not_blank_chk
      CHECK (length(btrim(barcode)) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_order_clinical_indication_not_blank_chk') THEN
    ALTER TABLE public."LabOrder"
      ADD CONSTRAINT lab_order_clinical_indication_not_blank_chk
      CHECK ("clinicalIndication" IS NULL OR length(btrim("clinicalIndication")) > 0);
  END IF;
END $$;

-- 5. Trigger state machine LabOrder.status ------------------------------------

CREATE OR REPLACE FUNCTION public.fn_validate_lab_order_status_transition()
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
  v_allowed := (OLD.status = 'DRAFT'      AND NEW.status IN ('ORDERED','CANCELLED'))
            OR (OLD.status = 'ORDERED'    AND NEW.status IN ('COLLECTED','CANCELLED'))
            OR (OLD.status = 'COLLECTED'  AND NEW.status IN ('IN_PROCESS','CANCELLED'))
            OR (OLD.status = 'IN_PROCESS' AND NEW.status IN ('RESULTED','CANCELLED'))
            OR (OLD.status = 'RESULTED'   AND NEW.status IN ('VALIDATED','CANCELLED'));
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transición inválida de LabOrder.status: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_lab_order_status_transition ON public."LabOrder";
CREATE TRIGGER tr_lab_order_status_transition
  BEFORE UPDATE ON public."LabOrder"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_lab_order_status_transition();
