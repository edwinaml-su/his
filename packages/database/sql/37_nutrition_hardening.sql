-- =============================================================================
-- §22 Nutrition — Hardening Layer 1 (Beta.13, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento, Edwin aprueba merge)
-- Estado: NO ejecutado en prod. Script para aplicación manual post-merge.
--
-- Cambios:
--   1. Nuevo valor en enum "NutritionOrderStatus": ORDERED (estado inicial).
--      HELD reemplaza ON_HOLD como nombre canónico; ON_HOLD se conserva para
--      backward compat con datos existentes.
--   2. Nueva columna "NutritionOrder".dietPlanId → FK a "DietPlan".
--   3. "NutritionOrder".status default cambia a ORDERED.
--   4. Nueva columna "DietPlan".compatibleWithDiagnoses TEXT[] DEFAULT '{}'.
--   5. Nueva columna "NutritionAssessment".targetCalories INTEGER.
--   6. Nueva columna "NutritionAssessment".signedAt TIMESTAMPTZ.
--   7. CHECK constraint: NutritionAssessment.targetCalories en 600–4000.
--   8. Índice en NutritionOrder.dietPlanId.
--   9. Trigger fn_nutrition_assessment_immutability: bloquea UPDATE/DELETE
--      en NutritionAssessment cuando signedAt IS NOT NULL.
--
-- Convención: SQL idempotente (DO $$ guards + CREATE INDEX IF NOT EXISTS).
-- Nombres de tabla: Prisma usa PascalCase en PostgreSQL por mapeo directo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Nuevos valores en enum NutritionOrderStatus
-- -----------------------------------------------------------------------------

-- ORDERED: estado inicial; órdenes antiguas pueden quedar como ACTIVE (OK).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'NutritionOrderStatus'
       AND e.enumlabel = 'ORDERED'
  ) THEN
    ALTER TYPE public."NutritionOrderStatus" ADD VALUE IF NOT EXISTS 'ORDERED';
  END IF;
END $$;

-- HELD: nombre canónico para la suspensión temporal (sustituye ON_HOLD en código).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'NutritionOrderStatus'
       AND e.enumlabel = 'HELD'
  ) THEN
    ALTER TYPE public."NutritionOrderStatus" ADD VALUE IF NOT EXISTS 'HELD';
  END IF;
END $$;

-- ON_HOLD se conserva en el tipo para retrocompatibilidad con datos existentes.
-- El nuevo código de aplicación sólo emite HELD.

-- -----------------------------------------------------------------------------
-- 2. DietPlan.compatibleWithDiagnoses
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'DietPlan'
       AND column_name  = 'compatibleWithDiagnoses'
  ) THEN
    ALTER TABLE public."DietPlan"
      ADD COLUMN "compatibleWithDiagnoses" TEXT[] NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. NutritionOrder.dietPlanId (FK nullable)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'NutritionOrder'
       AND column_name  = 'dietPlanId'
  ) THEN
    ALTER TABLE public."NutritionOrder"
      ADD COLUMN "dietPlanId" UUID NULL
        REFERENCES public."DietPlan"(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_nutrition_order_dietPlanId
  ON public."NutritionOrder" ("dietPlanId");

-- -----------------------------------------------------------------------------
-- 4. NutritionAssessment.targetCalories
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'NutritionAssessment'
       AND column_name  = 'targetCalories'
  ) THEN
    ALTER TABLE public."NutritionAssessment"
      ADD COLUMN "targetCalories" INTEGER NULL;
  END IF;
END $$;

-- CHECK: rango médicamente plausible 600–4000 kcal/día.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'nutrition_assessment_target_calories_range_chk'
  ) THEN
    ALTER TABLE public."NutritionAssessment"
      ADD CONSTRAINT nutrition_assessment_target_calories_range_chk
      CHECK (
        "targetCalories" IS NULL
        OR ("targetCalories" >= 600 AND "targetCalories" <= 4000)
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. NutritionAssessment.signedAt
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'NutritionAssessment'
       AND column_name  = 'signedAt'
  ) THEN
    ALTER TABLE public."NutritionAssessment"
      ADD COLUMN "signedAt" TIMESTAMPTZ NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Función + trigger: inmutabilidad post-firma de NutritionAssessment
--
-- Análogo a fn_clinical_note_immutability (29_ehr_notes_hardening.sql).
-- Lógica: si signedAt IS NOT NULL, rechaza UPDATE/DELETE.
-- El UPDATE que establece signedAt por primera vez es permitido
-- (OLD.signedAt IS NULL AND NEW.signedAt IS NOT NULL).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_nutrition_assessment_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- DELETE: nunca permitido sobre valoración firmada.
  IF TG_OP = 'DELETE' THEN
    IF OLD."signedAt" IS NOT NULL THEN
      RAISE EXCEPTION
        'nutrition_assessment_immutable: valoración % ya firmada (signedAt=%). No se permite DELETE.',
        OLD.id, OLD."signedAt"
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: sólo permitido cuando el registro aún no estaba firmado.
  -- Esto incluye el UPDATE que establece signedAt por primera vez.
  IF TG_OP = 'UPDATE' THEN
    IF OLD."signedAt" IS NOT NULL THEN
      RAISE EXCEPTION
        'nutrition_assessment_immutable: valoración % ya firmada (signedAt=%). No se permite UPDATE post-firma.',
        OLD.id, OLD."signedAt"
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- Wiring idempotente.
DROP TRIGGER IF EXISTS trg_nutrition_assessment_immutability ON public."NutritionAssessment";

CREATE TRIGGER trg_nutrition_assessment_immutability
  BEFORE UPDATE OR DELETE ON public."NutritionAssessment"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_nutrition_assessment_immutability();

-- =============================================================================
-- FIN 37_nutrition_hardening.sql
-- =============================================================================
