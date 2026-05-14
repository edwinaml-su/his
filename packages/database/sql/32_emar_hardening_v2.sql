-- =============================================================================
-- §16 eMAR — Hardening Layer 1 v2 (Beta.8, parche 2026-05-14)
--
-- v2: corrige naming PascalCase ("MedicationAdministration", "PrescriptionItem",
-- "User") y columnas camelCase quoted ("doseAmount", "doseUnit", "route",
-- "prescriptionItemId", "administeredById"). Las columnas NUEVAS también en
-- camelCase ("patientBarcodeScanned", "drugBarcodeScanned",
-- "providerBadgeScanned", "scannedAt", "secondVerifierId", "scheduledTime",
-- "timingWindowMinutes", "overrideReason", "prescribedQty", "administeredQty").
--
-- Nota: estas columnas viven fuera de Prisma schema hasta que se actualice.
--
-- Idempotente.
-- =============================================================================

-- 1. Columnas nuevas en MedicationAdministration ------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='MedicationAdministration'
      AND column_name='patientBarcodeScanned'
  ) THEN
    ALTER TABLE public."MedicationAdministration"
      ADD COLUMN "patientBarcodeScanned" BOOLEAN     NOT NULL DEFAULT FALSE,
      ADD COLUMN "drugBarcodeScanned"    BOOLEAN     NOT NULL DEFAULT FALSE,
      ADD COLUMN "providerBadgeScanned"  BOOLEAN     NOT NULL DEFAULT FALSE,
      ADD COLUMN "scannedAt"             TIMESTAMPTZ,
      ADD COLUMN "secondVerifierId"      UUID        REFERENCES public."User"(id),
      ADD COLUMN "scheduledTime"         TIMESTAMPTZ,
      ADD COLUMN "timingWindowMinutes"   INT         NOT NULL DEFAULT 30,
      ADD COLUMN "overrideReason"        VARCHAR(500);
  END IF;
END $$;

-- 2. Columnas nuevas en PrescriptionItem --------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='PrescriptionItem'
      AND column_name='prescribedQty'
  ) THEN
    ALTER TABLE public."PrescriptionItem"
      ADD COLUMN "prescribedQty"   NUMERIC(12,4) NOT NULL DEFAULT 0,
      ADD COLUMN "administeredQty" NUMERIC(12,4) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 3. CHECK constraints --------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='med_admin_timing_window_range_chk') THEN
    ALTER TABLE public."MedicationAdministration"
      ADD CONSTRAINT med_admin_timing_window_range_chk
      CHECK ("timingWindowMinutes" BETWEEN 1 AND 240);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prescription_item_prescribed_qty_nn_chk') THEN
    ALTER TABLE public."PrescriptionItem"
      ADD CONSTRAINT prescription_item_prescribed_qty_nn_chk
      CHECK ("prescribedQty" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prescription_item_administered_qty_nn_chk') THEN
    ALTER TABLE public."PrescriptionItem"
      ADD CONSTRAINT prescription_item_administered_qty_nn_chk
      CHECK ("administeredQty" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='med_admin_second_verifier_diff_chk') THEN
    ALTER TABLE public."MedicationAdministration"
      ADD CONSTRAINT med_admin_second_verifier_diff_chk
      CHECK (
        "secondVerifierId" IS NULL
        OR "secondVerifierId" <> "administeredById"
      );
  END IF;
END $$;

-- 4. Trigger AFTER INSERT — acumular qty en PrescriptionItem ------------------

CREATE OR REPLACE FUNCTION public.fn_emar_accumulate_administered_qty()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'ADMINISTERED' AND NEW."doseAmount" IS NOT NULL THEN
    UPDATE public."PrescriptionItem"
       SET "administeredQty" = "administeredQty" + NEW."doseAmount"
     WHERE id = NEW."prescriptionItemId";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_emar_accumulate_qty ON public."MedicationAdministration";
CREATE TRIGGER tr_emar_accumulate_qty
  AFTER INSERT ON public."MedicationAdministration"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_emar_accumulate_administered_qty();

-- 5. Trigger BEFORE UPDATE — inmutabilidad post-ADMINISTERED ------------------

CREATE OR REPLACE FUNCTION public.fn_emar_immutable_post_administered()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'ADMINISTERED' THEN
    IF (
      OLD."prescriptionItemId"      <> NEW."prescriptionItemId"      OR
      OLD."administeredById"        <> NEW."administeredById"        OR
      OLD.status                    <> NEW.status                    OR
      OLD."doseAmount"              IS DISTINCT FROM NEW."doseAmount" OR
      OLD."doseUnit"                IS DISTINCT FROM NEW."doseUnit"   OR
      OLD.route                     IS DISTINCT FROM NEW.route        OR
      OLD."patientBarcodeScanned"   <> NEW."patientBarcodeScanned"   OR
      OLD."drugBarcodeScanned"      <> NEW."drugBarcodeScanned"      OR
      OLD."providerBadgeScanned"    <> NEW."providerBadgeScanned"
    ) THEN
      RAISE EXCEPTION
        'El registro de administración (id=%) ya está en estado ADMINISTERED y es inmutable.',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_emar_immutable_post_administered ON public."MedicationAdministration";
CREATE TRIGGER tr_emar_immutable_post_administered
  BEFORE UPDATE ON public."MedicationAdministration"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_emar_immutable_post_administered();

-- 6. Índices adicionales ------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_med_admin_scheduled_time
  ON public."MedicationAdministration" ("scheduledTime")
  WHERE "scheduledTime" IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_med_admin_second_verifier
  ON public."MedicationAdministration" ("secondVerifierId")
  WHERE "secondVerifierId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_prescription_item_qty
  ON public."PrescriptionItem" ("prescriptionId", "administeredQty", "prescribedQty");
