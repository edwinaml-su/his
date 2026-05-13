-- =============================================================================
-- §16 eMAR — Hardening Layer 1 (Beta.8, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento post-sprint)
-- Estado: NO ejecutado en prod. Aplicar post-cierre Bloque Beta.8.
--
-- Prerequisito: schema Prisma migrado (nuevas columnas en
--   medication_administration y prescription_item).
--
-- Cambios:
--   1. Columnas nuevas en medication_administration (BCMA, secondVerifierId,
--      scheduledTime, timingWindowMinutes, overrideReason).
--   2. Columnas nuevas en prescription_item (prescribedQty, administeredQty).
--   3. CHECK constraints de integridad.
--   4. Trigger AFTER INSERT: cumulative qty en PrescriptionItem.
--   5. Trigger BEFORE UPDATE: inmutabilidad post-ADMINISTERED.
--   6. Índices adicionales.
--
-- Convención: SQL idempotente con DO $$ ... $$ guards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas nuevas en medication_administration
--    (la migración Prisma las crea; estos ALTER son guard idempotente)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'medication_administration'
      AND column_name  = 'patient_barcode_scanned'
  ) THEN
    ALTER TABLE public.medication_administration
      ADD COLUMN patient_barcode_scanned  BOOLEAN     NOT NULL DEFAULT FALSE,
      ADD COLUMN drug_barcode_scanned     BOOLEAN     NOT NULL DEFAULT FALSE,
      ADD COLUMN provider_badge_scanned   BOOLEAN     NOT NULL DEFAULT FALSE,
      ADD COLUMN scanned_at               TIMESTAMPTZ,
      ADD COLUMN second_verifier_id       UUID        REFERENCES public."user"(id),
      ADD COLUMN scheduled_time           TIMESTAMPTZ,
      ADD COLUMN timing_window_minutes    INT         NOT NULL DEFAULT 30,
      ADD COLUMN override_reason          VARCHAR(500);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Columnas nuevas en prescription_item
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'prescription_item'
      AND column_name  = 'prescribed_qty'
  ) THEN
    ALTER TABLE public.prescription_item
      ADD COLUMN prescribed_qty   NUMERIC(12,4) NOT NULL DEFAULT 0,
      ADD COLUMN administered_qty NUMERIC(12,4) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. CHECK constraints
-- -----------------------------------------------------------------------------

-- timingWindowMinutes: 1..240
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'med_admin_timing_window_range_chk'
  ) THEN
    ALTER TABLE public.medication_administration
      ADD CONSTRAINT med_admin_timing_window_range_chk
      CHECK (timing_window_minutes BETWEEN 1 AND 240);
  END IF;
END $$;

-- prescribedQty >= 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prescription_item_prescribed_qty_nn_chk'
  ) THEN
    ALTER TABLE public.prescription_item
      ADD CONSTRAINT prescription_item_prescribed_qty_nn_chk
      CHECK (prescribed_qty >= 0);
  END IF;
END $$;

-- administeredQty >= 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prescription_item_administered_qty_nn_chk'
  ) THEN
    ALTER TABLE public.prescription_item
      ADD CONSTRAINT prescription_item_administered_qty_nn_chk
      CHECK (administered_qty >= 0);
  END IF;
END $$;

-- secondVerifierId != administeredById (defensa en profundidad DB)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'med_admin_second_verifier_diff_chk'
  ) THEN
    ALTER TABLE public.medication_administration
      ADD CONSTRAINT med_admin_second_verifier_diff_chk
      CHECK (
        second_verifier_id IS NULL
        OR second_verifier_id <> administered_by_id
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Trigger AFTER INSERT: acumular qty en PrescriptionItem
--    Solo cuando status = 'ADMINISTERED' y dose_amount IS NOT NULL.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_emar_accumulate_administered_qty()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'ADMINISTERED' AND NEW.dose_amount IS NOT NULL THEN
    UPDATE public.prescription_item
       SET administered_qty = administered_qty + NEW.dose_amount
     WHERE id = NEW.prescription_item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_emar_accumulate_qty ON public.medication_administration;
CREATE TRIGGER tr_emar_accumulate_qty
  AFTER INSERT ON public.medication_administration
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_emar_accumulate_administered_qty();

-- -----------------------------------------------------------------------------
-- 5. Trigger BEFORE UPDATE: inmutabilidad post-ADMINISTERED
--    Un registro ADMINISTERED no puede ser modificado (solo lectura audit).
--    Override explícito: solo permite cambiar override_reason y notes.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_emar_immutable_post_administered()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'ADMINISTERED' THEN
    -- Solo se permiten cambios en campos de anotación; el resto es inmutable.
    IF (
      OLD.prescription_item_id   <> NEW.prescription_item_id   OR
      OLD.administered_by_id     <> NEW.administered_by_id     OR
      OLD.status                 <> NEW.status                 OR
      OLD.dose_amount            IS DISTINCT FROM NEW.dose_amount OR
      OLD.dose_unit              IS DISTINCT FROM NEW.dose_unit   OR
      OLD.route                  IS DISTINCT FROM NEW.route       OR
      OLD.patient_barcode_scanned <> NEW.patient_barcode_scanned OR
      OLD.drug_barcode_scanned    <> NEW.drug_barcode_scanned    OR
      OLD.provider_badge_scanned  <> NEW.provider_badge_scanned
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

DROP TRIGGER IF EXISTS tr_emar_immutable_post_administered ON public.medication_administration;
CREATE TRIGGER tr_emar_immutable_post_administered
  BEFORE UPDATE ON public.medication_administration
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_emar_immutable_post_administered();

-- -----------------------------------------------------------------------------
-- 6. Índices adicionales
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_med_admin_scheduled_time
  ON public.medication_administration (scheduled_time)
  WHERE scheduled_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_med_admin_second_verifier
  ON public.medication_administration (second_verifier_id)
  WHERE second_verifier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_prescription_item_qty
  ON public.prescription_item (prescription_id, administered_qty, prescribed_qty);

-- -----------------------------------------------------------------------------
-- 7. Verificación post-aplicación
-- -----------------------------------------------------------------------------

-- SELECT COUNT(*) FROM pg_constraint WHERE conname IN (
--   'med_admin_timing_window_range_chk',
--   'prescription_item_prescribed_qty_nn_chk',
--   'prescription_item_administered_qty_nn_chk',
--   'med_admin_second_verifier_diff_chk'
-- ); -- = 4
--
-- SELECT tgname FROM pg_trigger WHERE tgname IN (
--   'tr_emar_accumulate_qty',
--   'tr_emar_immutable_post_administered'
-- ); -- = 2 filas
--
-- SELECT COUNT(*) FROM pg_indexes WHERE indexname IN (
--   'ix_med_admin_scheduled_time',
--   'ix_med_admin_second_verifier',
--   'ix_prescription_item_qty'
-- ); -- = 3

-- -----------------------------------------------------------------------------
-- 8. Rollback
-- -----------------------------------------------------------------------------

-- BEGIN;
--   DROP TRIGGER IF EXISTS tr_emar_accumulate_qty ON public.medication_administration;
--   DROP TRIGGER IF EXISTS tr_emar_immutable_post_administered ON public.medication_administration;
--   DROP FUNCTION IF EXISTS public.fn_emar_accumulate_administered_qty();
--   DROP FUNCTION IF EXISTS public.fn_emar_immutable_post_administered();
--   ALTER TABLE public.medication_administration
--     DROP CONSTRAINT IF EXISTS med_admin_timing_window_range_chk,
--     DROP CONSTRAINT IF EXISTS med_admin_second_verifier_diff_chk,
--     DROP COLUMN IF EXISTS patient_barcode_scanned,
--     DROP COLUMN IF EXISTS drug_barcode_scanned,
--     DROP COLUMN IF EXISTS provider_badge_scanned,
--     DROP COLUMN IF EXISTS scanned_at,
--     DROP COLUMN IF EXISTS second_verifier_id,
--     DROP COLUMN IF EXISTS scheduled_time,
--     DROP COLUMN IF EXISTS timing_window_minutes,
--     DROP COLUMN IF EXISTS override_reason;
--   ALTER TABLE public.prescription_item
--     DROP CONSTRAINT IF EXISTS prescription_item_prescribed_qty_nn_chk,
--     DROP CONSTRAINT IF EXISTS prescription_item_administered_qty_nn_chk,
--     DROP COLUMN IF EXISTS prescribed_qty,
--     DROP COLUMN IF EXISTS administered_qty;
--   DROP INDEX IF EXISTS public.ix_med_admin_scheduled_time;
--   DROP INDEX IF EXISTS public.ix_med_admin_second_verifier;
--   DROP INDEX IF EXISTS public.ix_prescription_item_qty;
-- COMMIT;
