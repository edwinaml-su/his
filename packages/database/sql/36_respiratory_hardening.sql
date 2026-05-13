-- =============================================================================
-- §21 Respiratory — Hardening Layer 1 (Beta.12, 2026-05-13)
--
-- Owner : @DBA (revisar) + @SRE (aplicar en mantenimiento, Edwin aprueba merge)
-- Estado: NO ejecutado en prod. Script para aplicación manual post-merge.
--
-- Cambios:
--   1. Nuevo enum "VentilatorSessionStatus" con valores del state machine.
--   2. Nuevas columnas en "RespiratoryOrder":
--        expiresAt   TIMESTAMPTZ  — fecha de expiración de la orden (default: +24h).
--        renewedAt   TIMESTAMPTZ  — timestamp de la última renovación.
--   3. Nuevas columnas en "VentilatorSession":
--        statusSM        VentilatorSessionStatus — estado en la state machine.
--        patientWeightKg NUMERIC(6,2)            — peso del paciente (Vt/kg).
--        outOfRangeSince TIMESTAMPTZ             — inicio del período fuera de rango.
--        alertFiredAt    TIMESTAMPTZ             — timestamp de alerta crítica (>5 min).
--   4. Índices adicionales en RespiratoryOrder (expiresAt) y VentilatorSession (statusSM).
--   5. Trigger BEFORE UPDATE/DELETE en "MedicalGasUsage": append-only post-administración.
--   6. Función placeholder fn_respiratory_critical_alert: detecta sesiones con parámetros
--      fuera de rango por >5 min (no envía notificación real; capa 1 sólo marca alertFiredAt).
--   7. CHECK constraints para rangos de parámetros ventilatorios en "VentilatorSession".
--
-- Convención: SQL idempotente (DO $$ guards + IF NOT EXISTS).
-- Nombres de tabla: Prisma usa PascalCase en PostgreSQL por mapeo directo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Nuevo enum VentilatorSessionStatus
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
     WHERE typname = 'VentilatorSessionStatus'
       AND typtype = 'e'
  ) THEN
    CREATE TYPE public."VentilatorSessionStatus" AS ENUM (
      'ACTIVE',
      'WEANING',
      'EXTUBATED',
      'ESCALATED',
      'FAILED_EXTUBATION'
    );
  END IF;
END $$;

-- Add values idempotently in case enum exists from a prior partial migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'VentilatorSessionStatus' AND e.enumlabel = 'WEANING'
  ) THEN
    ALTER TYPE public."VentilatorSessionStatus" ADD VALUE IF NOT EXISTS 'WEANING';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'VentilatorSessionStatus' AND e.enumlabel = 'EXTUBATED'
  ) THEN
    ALTER TYPE public."VentilatorSessionStatus" ADD VALUE IF NOT EXISTS 'EXTUBATED';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'VentilatorSessionStatus' AND e.enumlabel = 'ESCALATED'
  ) THEN
    ALTER TYPE public."VentilatorSessionStatus" ADD VALUE IF NOT EXISTS 'ESCALATED';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'VentilatorSessionStatus' AND e.enumlabel = 'FAILED_EXTUBATION'
  ) THEN
    ALTER TYPE public."VentilatorSessionStatus" ADD VALUE IF NOT EXISTS 'FAILED_EXTUBATION';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Nuevas columnas en RespiratoryOrder
-- -----------------------------------------------------------------------------

-- expiresAt: expiración de la orden (startedAt + 24h por defecto).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'RespiratoryOrder'
       AND column_name  = 'expiresAt'
  ) THEN
    ALTER TABLE public."RespiratoryOrder"
      ADD COLUMN "expiresAt" TIMESTAMPTZ NULL;
    -- Back-fill existing rows: expiresAt = startedAt + 24h.
    UPDATE public."RespiratoryOrder"
       SET "expiresAt" = "startedAt" + INTERVAL '24 hours'
     WHERE "expiresAt" IS NULL;
  END IF;
END $$;

-- renewedAt: timestamp de la última renovación.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'RespiratoryOrder'
       AND column_name  = 'renewedAt'
  ) THEN
    ALTER TABLE public."RespiratoryOrder"
      ADD COLUMN "renewedAt" TIMESTAMPTZ NULL;
  END IF;
END $$;

-- Índice para getExpiredOrders query.
CREATE INDEX IF NOT EXISTS ix_respiratory_order_expires_at
  ON public."RespiratoryOrder" ("expiresAt");

-- -----------------------------------------------------------------------------
-- 3. Nuevas columnas en VentilatorSession
-- -----------------------------------------------------------------------------

-- statusSM: estado en la state machine de destete.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'VentilatorSession'
       AND column_name  = 'statusSM'
  ) THEN
    ALTER TABLE public."VentilatorSession"
      ADD COLUMN "statusSM" public."VentilatorSessionStatus"
        NOT NULL DEFAULT 'ACTIVE';
  END IF;
END $$;

-- patientWeightKg: peso del paciente para validación Vt/kg.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'VentilatorSession'
       AND column_name  = 'patientWeightKg'
  ) THEN
    ALTER TABLE public."VentilatorSession"
      ADD COLUMN "patientWeightKg" NUMERIC(6, 2) NULL;
  END IF;
END $$;

-- outOfRangeSince: inicio del intervalo con parámetros fuera de rango.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'VentilatorSession'
       AND column_name  = 'outOfRangeSince'
  ) THEN
    ALTER TABLE public."VentilatorSession"
      ADD COLUMN "outOfRangeSince" TIMESTAMPTZ NULL;
  END IF;
END $$;

-- alertFiredAt: marca de tiempo de la alerta crítica (>5 min fuera de rango).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'VentilatorSession'
       AND column_name  = 'alertFiredAt'
  ) THEN
    ALTER TABLE public."VentilatorSession"
      ADD COLUMN "alertFiredAt" TIMESTAMPTZ NULL;
  END IF;
END $$;

-- Índice para queries de destete por estado.
CREATE INDEX IF NOT EXISTS ix_ventilator_session_status_sm
  ON public."VentilatorSession" ("statusSM");

-- -----------------------------------------------------------------------------
-- 4. CHECK constraints — rangos de parámetros ventilatorios seguros
--
-- PEEP    : 5–20 cmH2O
-- FiO2    : 0.21–1.0  (fracción)
-- rrSet   : 8–30 breaths/min
-- Vt      : 50–1500 mL (absolute)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vent_session_peep_range_chk'
  ) THEN
    ALTER TABLE public."VentilatorSession"
      ADD CONSTRAINT vent_session_peep_range_chk
      CHECK ("peep" IS NULL OR ("peep" >= 5 AND "peep" <= 20));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vent_session_fio2_range_chk'
  ) THEN
    -- fio2 stored as fraction 0.21–1.0 (Beta.12 normalisation).
    -- Legacy rows with percentage values (21–100) must be migrated by @DBA
    -- before this constraint is added in production.
    ALTER TABLE public."VentilatorSession"
      ADD CONSTRAINT vent_session_fio2_range_chk
      CHECK ("fio2" IS NULL OR ("fio2" >= 0.21 AND "fio2" <= 1.0));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vent_session_rr_range_chk'
  ) THEN
    ALTER TABLE public."VentilatorSession"
      ADD CONSTRAINT vent_session_rr_range_chk
      CHECK ("rrSet" IS NULL OR ("rrSet" >= 8 AND "rrSet" <= 30));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vent_session_tidal_volume_range_chk'
  ) THEN
    ALTER TABLE public."VentilatorSession"
      ADD CONSTRAINT vent_session_tidal_volume_range_chk
      CHECK ("tidalVolume" IS NULL OR ("tidalVolume" >= 50 AND "tidalVolume" <= 1500));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Trigger: MedicalGasUsage append-only post-administración
--
-- Blocks any UPDATE or DELETE on MedicalGasUsage rows.
-- Rationale: gas consumption records are forensic audit data; once an
-- administration is recorded it must not be altered. Corrections are made
-- by inserting a new record with a negative volumeLiters (reversal pattern).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_medical_gas_usage_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'medical_gas_usage_append_only: registro % de gas médico no puede eliminarse. '
      'Para corregir, insertar un registro con volumen negativo.',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'medical_gas_usage_append_only: registro % de gas médico es inmutable post-administración. '
      'Para corregir, insertar un registro con volumen negativo.',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Wiring idempotente.
DROP TRIGGER IF EXISTS trg_medical_gas_usage_append_only ON public."MedicalGasUsage";

CREATE TRIGGER trg_medical_gas_usage_append_only
  BEFORE UPDATE OR DELETE ON public."MedicalGasUsage"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_medical_gas_usage_append_only();

-- -----------------------------------------------------------------------------
-- 6. Función placeholder: fn_respiratory_critical_alert
--
-- Layer 1 implementation: marks alertFiredAt when outOfRangeSince is set
-- and the out-of-range duration exceeds 5 minutes.
-- No real notification is sent; the application layer reacts to alertFiredAt.
-- Called as a BEFORE UPDATE trigger on VentilatorSession.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_respiratory_critical_alert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_threshold_minutes CONSTANT INT := 5;
BEGIN
  -- Only evaluate on UPDATE when outOfRangeSince is set.
  IF TG_OP = 'UPDATE' AND NEW."outOfRangeSince" IS NOT NULL THEN
    -- Fire alert if duration > threshold AND alert not yet fired.
    IF NEW."alertFiredAt" IS NULL AND
       (now() - NEW."outOfRangeSince") > (v_threshold_minutes * INTERVAL '1 minute')
    THEN
      NEW."alertFiredAt" := now();
      -- Placeholder: in layer 2, insert into a clinical_alert table here.
    END IF;
  END IF;

  -- When outOfRangeSince is cleared (params back in range), reset alert marker.
  IF TG_OP = 'UPDATE' AND NEW."outOfRangeSince" IS NULL THEN
    NEW."alertFiredAt" := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Wiring idempotente.
DROP TRIGGER IF EXISTS trg_respiratory_critical_alert ON public."VentilatorSession";

CREATE TRIGGER trg_respiratory_critical_alert
  BEFORE UPDATE ON public."VentilatorSession"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_respiratory_critical_alert();

-- =============================================================================
-- FIN 36_respiratory_hardening.sql
-- =============================================================================
