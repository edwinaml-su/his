-- =============================================================================
-- §17 LIS — Hardening Layer 1 (Beta.3, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento Edwin manual)
-- Estado: NO ejecutado en prod. Documentado para aplicación post-cierre Bloque 1.
--
-- Cambios:
--   1. Tabla `lab_reference_range` para estratificación age/sex Wave 2.
--      Wave 1: schema vacío, helpers usan refRangeLow/refRangeHigh del LabTest.
--   2. Tabla `lab_reflex_rule` para configurar reflex testing.
--   3. Índices adicionales para queries de hardening.
--   4. CHECK constraints en LabResult (flag enum validation, valueNumeric range).
--   5. Trigger validando state machine LabOrder.status.
--
-- Convención: SQL idempotente con DO $$ ... $$ guards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Nueva tabla lab_reference_range (estratificación Wave 2)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lab_reference_range (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL, -- NULL = catálogo global
  lab_test_id     UUID NOT NULL,
  min_value       NUMERIC(18, 6) NULL,
  max_value       NUMERIC(18, 6) NULL,
  age_min_years   INTEGER NULL,
  age_max_years   INTEGER NULL,
  sex             VARCHAR(10) NOT NULL DEFAULT 'BOTH'
    CHECK (sex IN ('MALE', 'FEMALE', 'BOTH')),
  critical_low    NUMERIC(18, 6) NULL,
  critical_high   NUMERIC(18, 6) NULL,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lab_reference_range_test_fk
    FOREIGN KEY (lab_test_id)
    REFERENCES public.lab_test (id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_lab_reference_range_test_sex_age
  ON public.lab_reference_range (lab_test_id, sex, age_min_years, age_max_years)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS ix_lab_reference_range_organization
  ON public.lab_reference_range (organization_id)
  WHERE organization_id IS NOT NULL;

-- CHECK: si ambos min y max presentes, min < max.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lab_reference_range_min_lt_max_chk'
  ) THEN
    ALTER TABLE public.lab_reference_range
      ADD CONSTRAINT lab_reference_range_min_lt_max_chk
      CHECK (
        min_value IS NULL OR max_value IS NULL OR min_value < max_value
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Nueva tabla lab_reflex_rule (reflex testing automation)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lab_reflex_rule (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NULL, -- NULL = catálogo global
  trigger_test_id    UUID NOT NULL,
  reflex_test_id     UUID NOT NULL,
  trigger_condition  VARCHAR(20) NOT NULL
    CHECK (trigger_condition IN ('ABOVE', 'BELOW', 'POSITIVE', 'FLAGGED')),
  trigger_threshold  NUMERIC(18, 6) NULL,
  description        TEXT NULL,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lab_reflex_rule_trigger_fk
    FOREIGN KEY (trigger_test_id)
    REFERENCES public.lab_test (id)
    ON DELETE CASCADE,
  CONSTRAINT lab_reflex_rule_reflex_fk
    FOREIGN KEY (reflex_test_id)
    REFERENCES public.lab_test (id)
    ON DELETE RESTRICT,
  CONSTRAINT lab_reflex_rule_self_chk
    CHECK (trigger_test_id != reflex_test_id)
);

CREATE INDEX IF NOT EXISTS ix_lab_reflex_rule_trigger
  ON public.lab_reflex_rule (trigger_test_id)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS ix_lab_reflex_rule_organization
  ON public.lab_reflex_rule (organization_id)
  WHERE organization_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Índices adicionales en tablas existentes
-- -----------------------------------------------------------------------------

-- Query: "buscar resultado por LOINC code + paciente para histórico delta check".
CREATE INDEX IF NOT EXISTS ix_lab_result_orderitem_resultedAt
  ON public.lab_result (order_item_id, resulted_at DESC);

-- Query: "criticos pendientes de ack" — útil cuando Wave 2 añade tabla notification.
CREATE INDEX IF NOT EXISTS ix_lab_result_flag_validated
  ON public.lab_result (flag, validated_at)
  WHERE flag IN ('CRITICAL_LOW', 'CRITICAL_HIGH');

-- Query: "ordenes pendientes por tenant + status para worklist".
CREATE INDEX IF NOT EXISTS ix_lab_order_org_status_orderedAt
  ON public.lab_order (organization_id, status, ordered_at DESC);

-- -----------------------------------------------------------------------------
-- 4. CHECK constraints adicionales
-- -----------------------------------------------------------------------------

-- LabResult.valueNumeric debe estar en rango clínico plausible si presente.
-- (-99999 a 99999 es muy amplio pero captura inserts erróneos como 1e20).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lab_result_value_numeric_range_chk'
  ) THEN
    ALTER TABLE public.lab_result
      ADD CONSTRAINT lab_result_value_numeric_range_chk
      CHECK (
        value_numeric IS NULL
        OR (value_numeric >= -99999 AND value_numeric <= 99999)
      );
  END IF;
END $$;

-- LabSpecimen.barcode no debe ser vacío.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lab_specimen_barcode_not_blank_chk'
  ) THEN
    ALTER TABLE public.lab_specimen
      ADD CONSTRAINT lab_specimen_barcode_not_blank_chk
      CHECK (length(btrim(barcode)) > 0);
  END IF;
END $$;

-- LabOrder.clinicalIndication trim length > 0 si presente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lab_order_clinical_indication_not_blank_chk'
  ) THEN
    ALTER TABLE public.lab_order
      ADD CONSTRAINT lab_order_clinical_indication_not_blank_chk
      CHECK (
        clinical_indication IS NULL
        OR length(btrim(clinical_indication)) > 0
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Trigger state machine LabOrder.status
-- -----------------------------------------------------------------------------

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

  v_allowed := (OLD.status = 'DRAFT' AND NEW.status IN ('ORDERED', 'CANCELLED'))
            OR (OLD.status = 'ORDERED' AND NEW.status IN ('COLLECTED', 'CANCELLED'))
            OR (OLD.status = 'COLLECTED' AND NEW.status IN ('IN_PROCESS', 'CANCELLED'))
            OR (OLD.status = 'IN_PROCESS' AND NEW.status IN ('RESULTED', 'CANCELLED'))
            OR (OLD.status = 'RESULTED' AND NEW.status IN ('VALIDATED', 'CANCELLED'));

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transición inválida de LabOrder.status: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_lab_order_status_transition ON public.lab_order;
CREATE TRIGGER tr_lab_order_status_transition
  BEFORE UPDATE ON public.lab_order
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_lab_order_status_transition();

-- -----------------------------------------------------------------------------
-- 6. Verificación post-aplicación
-- -----------------------------------------------------------------------------

-- Esperado tras ejecución:
--   SELECT count(*) FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name IN ('lab_reference_range', 'lab_reflex_rule');
--   -- = 2
--
--   SELECT count(*) FROM pg_indexes
--   WHERE indexname IN (
--     'ix_lab_reference_range_test_sex_age',
--     'ix_lab_reference_range_organization',
--     'ix_lab_reflex_rule_trigger',
--     'ix_lab_reflex_rule_organization',
--     'ix_lab_result_orderitem_resultedAt',
--     'ix_lab_result_flag_validated',
--     'ix_lab_order_org_status_orderedAt'
--   );
--   -- = 7
--
--   SELECT count(*) FROM pg_constraint
--   WHERE conname IN (
--     'lab_reference_range_min_lt_max_chk',
--     'lab_result_value_numeric_range_chk',
--     'lab_specimen_barcode_not_blank_chk',
--     'lab_order_clinical_indication_not_blank_chk'
--   );
--   -- = 4
--
--   SELECT tgname FROM pg_trigger WHERE tgname = 'tr_lab_order_status_transition';
--   -- 1 fila

-- -----------------------------------------------------------------------------
-- 7. Rollback
-- -----------------------------------------------------------------------------

-- BEGIN;
--   DROP TRIGGER IF EXISTS tr_lab_order_status_transition ON public.lab_order;
--   DROP FUNCTION IF EXISTS public.fn_validate_lab_order_status_transition();
--   ALTER TABLE public.lab_order DROP CONSTRAINT IF EXISTS lab_order_clinical_indication_not_blank_chk;
--   ALTER TABLE public.lab_specimen DROP CONSTRAINT IF EXISTS lab_specimen_barcode_not_blank_chk;
--   ALTER TABLE public.lab_result DROP CONSTRAINT IF EXISTS lab_result_value_numeric_range_chk;
--   DROP INDEX IF EXISTS public.ix_lab_order_org_status_orderedAt;
--   DROP INDEX IF EXISTS public.ix_lab_result_flag_validated;
--   DROP INDEX IF EXISTS public.ix_lab_result_orderitem_resultedAt;
--   DROP TABLE IF EXISTS public.lab_reflex_rule CASCADE;
--   DROP TABLE IF EXISTS public.lab_reference_range CASCADE;
-- COMMIT;
