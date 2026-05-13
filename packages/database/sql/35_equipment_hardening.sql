-- =============================================================================
-- §20 Services & Equipment — Hardening Layer 1 (Beta.11, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento, Edwin aprueba merge)
-- Estado: NO ejecutado en prod. Script para aplicación manual post-merge.
--
-- Cambios:
--   1. Nuevo enum "CriticalityLevel": LOW / MEDIUM / HIGH / CRITICAL.
--   2. Nuevo valor "BROKEN" en enum "EquipmentStatus".
--   3. Nueva columna BiomedicalEquipment.criticality (CriticalityLevel, default MEDIUM).
--   4. Nueva columna BiomedicalEquipment.certificationExpiresAt (TIMESTAMPTZ nullable).
--   5. Nueva columna BiomedicalEquipment.maintenanceReason (VARCHAR(500) nullable).
--   6. Índice sobre (organizationId, certificationExpiresAt) para queries de vencimiento.
--   7. Función + trigger BEFORE INSERT OR UPDATE OR DELETE en "CalibrationLog":
--      bloquea UPDATE y DELETE (append-only, trazabilidad metrológica).
--
-- Convención: SQL idempotente (CREATE IF NOT EXISTS + DO $$ guards).
-- Nombres de tabla: Prisma usa PascalCase en PostgreSQL por mapeo directo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Nuevo tipo enum CriticalityLevel
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
     WHERE typname = 'CriticalityLevel'
       AND typtype = 'e'
  ) THEN
    CREATE TYPE public."CriticalityLevel" AS ENUM (
      'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Nuevo valor BROKEN en EquipmentStatus
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'EquipmentStatus'
       AND e.enumlabel = 'BROKEN'
  ) THEN
    ALTER TYPE public."EquipmentStatus" ADD VALUE IF NOT EXISTS 'BROKEN';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Nueva columna BiomedicalEquipment.criticality
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'BiomedicalEquipment'
       AND column_name  = 'criticality'
  ) THEN
    ALTER TABLE public."BiomedicalEquipment"
      ADD COLUMN "criticality" public."CriticalityLevel" NOT NULL DEFAULT 'MEDIUM';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Nueva columna BiomedicalEquipment.certificationExpiresAt
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'BiomedicalEquipment'
       AND column_name  = 'certificationExpiresAt'
  ) THEN
    ALTER TABLE public."BiomedicalEquipment"
      ADD COLUMN "certificationExpiresAt" TIMESTAMPTZ NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Nueva columna BiomedicalEquipment.maintenanceReason
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'BiomedicalEquipment'
       AND column_name  = 'maintenanceReason'
  ) THEN
    ALTER TABLE public."BiomedicalEquipment"
      ADD COLUMN "maintenanceReason" VARCHAR(500) NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Índice para queries de vencimiento de certificación
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_biomedical_equipment_cert_expires
  ON public."BiomedicalEquipment" ("organizationId", "certificationExpiresAt");

-- -----------------------------------------------------------------------------
-- 7. Función + trigger: append-only en CalibrationLog
--
-- Lógica: CalibrationLog NO tiene columna de validación post-hoc (a diferencia
-- de ImagingReport). Toda fila es inmutable desde inserción: UPDATE y DELETE
-- están bloqueados incondicionalmente.
-- El trigger se dispara BEFORE para que el RAISE aborte la operación.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_calibration_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'calibration_log_append_only: entrada % no puede eliminarse (trazabilidad metrológica).',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'calibration_log_append_only: entrada % no puede modificarse (trazabilidad metrológica).',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- INSERT: permitido, retornar NEW.
  RETURN NEW;
END;
$$;

-- Wiring idempotente: DROP IF EXISTS antes de CREATE.
DROP TRIGGER IF EXISTS trg_calibration_log_append_only ON public."CalibrationLog";

CREATE TRIGGER trg_calibration_log_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public."CalibrationLog"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_calibration_log_append_only();

-- =============================================================================
-- FIN 35_equipment_hardening.sql
-- =============================================================================
