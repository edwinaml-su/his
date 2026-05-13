-- =============================================================================
-- §18 RIS/PACS — Imaging Hardening Layer 1 (Beta.9, 2026-05-13)
--
-- Owner: @DBA (revisar) + @SRE (aplicar en mantenimiento, Edwin aprueba merge)
-- Estado: NO ejecutado en prod. Script para aplicación manual post-merge.
--
-- Cambios:
--   1. Nuevas columnas en "ImagingModality": dicomCode (enum DicomModality).
--   2. Nuevas columnas en "ImagingOrder":
--        orderedAt        TIMESTAMPTZ (base SLA)
--        completedAt      TIMESTAMPTZ (transición COMPLETED)
--        radiationDoseDap NUMERIC(10,4) — DAP en cGy·cm²
--        radiationDoseCtdi NUMERIC(10,4) — CTDIvol en mGy
--   3. Nueva columna en "ImagingReport": validatedAt TIMESTAMPTZ.
--   4. Nuevos valores en enum "ImagingOrderStatus": COMPLETED, VALIDATED.
--      Reemplaza ACQUIRED con COMPLETED en el flujo principal.
--   5. Nuevo tipo enum "DicomModality" con valores CT/MR/US/XR/MG/NM/PT/DX/RF.
--   6. CHECK constraint en ImagingOrder.radiationDoseDap / radiationDoseCtdi
--      para valores positivos.
--   7. Trigger BEFORE UPDATE/DELETE en "ImagingReport": bloquea toda mutación
--      cuando validatedAt IS NOT NULL (inmutabilidad post-validación).
--   8. Índice adicional en "ImagingOrder" sobre orderedAt para queries SLA.
--
-- Convención: SQL idempotente (CREATE IF NOT EXISTS + DO $$ guards).
-- Nombres de tabla: Prisma usa PascalCase en PostgreSQL por mapeo directo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Nuevo tipo enum DicomModality
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
     WHERE typname = 'DicomModality'
       AND typtype = 'e'
  ) THEN
    CREATE TYPE public."DicomModality" AS ENUM (
      'CT', 'MR', 'US', 'XR', 'MG', 'NM', 'PT', 'DX', 'RF'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Nuevos valores en ImagingOrderStatus (COMPLETED, VALIDATED)
-- -----------------------------------------------------------------------------
-- Prisma gestiona enums como tipos PG. Añadimos valores faltantes idempotentemente.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'ImagingOrderStatus'
       AND e.enumlabel = 'COMPLETED'
  ) THEN
    ALTER TYPE public."ImagingOrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'ImagingOrderStatus'
       AND e.enumlabel = 'VALIDATED'
  ) THEN
    ALTER TYPE public."ImagingOrderStatus" ADD VALUE IF NOT EXISTS 'VALIDATED';
  END IF;
END $$;

-- Note: ACQUIRED is kept in the enum for backward compat with existing data;
-- new orders use COMPLETED. No data migration needed at layer 1.

-- -----------------------------------------------------------------------------
-- 3. Nueva columna ImagingModality.dicomCode
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ImagingModality'
       AND column_name  = 'dicomCode'
  ) THEN
    ALTER TABLE public."ImagingModality"
      ADD COLUMN "dicomCode" public."DicomModality" NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Nuevas columnas en ImagingOrder
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ImagingOrder'
       AND column_name  = 'orderedAt'
  ) THEN
    -- Default now() fills existing rows with current timestamp.
    -- In production, existing rows represent historical orders; DBA may back-fill
    -- from createdAt if needed.
    ALTER TABLE public."ImagingOrder"
      ADD COLUMN "orderedAt" TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ImagingOrder'
       AND column_name  = 'completedAt'
  ) THEN
    ALTER TABLE public."ImagingOrder"
      ADD COLUMN "completedAt" TIMESTAMPTZ NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ImagingOrder'
       AND column_name  = 'radiationDoseDap'
  ) THEN
    ALTER TABLE public."ImagingOrder"
      ADD COLUMN "radiationDoseDap" NUMERIC(10, 4) NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ImagingOrder'
       AND column_name  = 'radiationDoseCtdi'
  ) THEN
    ALTER TABLE public."ImagingOrder"
      ADD COLUMN "radiationDoseCtdi" NUMERIC(10, 4) NULL;
  END IF;
END $$;

-- CHECK: radiation dose values must be positive when provided.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'imaging_order_radiation_dap_positive_chk'
  ) THEN
    ALTER TABLE public."ImagingOrder"
      ADD CONSTRAINT imaging_order_radiation_dap_positive_chk
      CHECK ("radiationDoseDap" IS NULL OR "radiationDoseDap" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'imaging_order_radiation_ctdi_positive_chk'
  ) THEN
    ALTER TABLE public."ImagingOrder"
      ADD CONSTRAINT imaging_order_radiation_ctdi_positive_chk
      CHECK ("radiationDoseCtdi" IS NULL OR "radiationDoseCtdi" > 0);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Nueva columna ImagingReport.validatedAt
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ImagingReport'
       AND column_name  = 'validatedAt'
  ) THEN
    ALTER TABLE public."ImagingReport"
      ADD COLUMN "validatedAt" TIMESTAMPTZ NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Índice SLA en ImagingOrder.orderedAt
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_imaging_order_orderedAt
  ON public."ImagingOrder" ("orderedAt");

-- -----------------------------------------------------------------------------
-- 7. Función + trigger: inmutabilidad post-validación de ImagingReport
--
-- Lógica: si validatedAt IS NOT NULL, bloquear cualquier UPDATE o DELETE.
-- El UPDATE que establece validatedAt por primera vez es permitido
-- (OLD.validatedAt IS NULL AND NEW.validatedAt IS NOT NULL).
-- Análogo a fn_clinical_note_immutability en 29_ehr_notes_hardening.sql.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_imaging_report_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- DELETE: nunca permitido sobre reporte validado.
  IF TG_OP = 'DELETE' THEN
    IF OLD."validatedAt" IS NOT NULL THEN
      RAISE EXCEPTION
        'imaging_report_immutable: reporte % ya validado (validatedAt=%). No se permite DELETE.',
        OLD.id, OLD."validatedAt"
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: permitido sólo cuando el reporte aún no estaba validado.
  -- Esto incluye el UPDATE que establece validatedAt por primera vez.
  IF TG_OP = 'UPDATE' THEN
    IF OLD."validatedAt" IS NOT NULL THEN
      RAISE EXCEPTION
        'imaging_report_immutable: reporte % ya validado (validatedAt=%). No se permite UPDATE post-validación.',
        OLD.id, OLD."validatedAt"
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- Wiring idempotente: DROP IF EXISTS antes de CREATE.
DROP TRIGGER IF EXISTS trg_imaging_report_immutability ON public."ImagingReport";

CREATE TRIGGER trg_imaging_report_immutability
  BEFORE UPDATE OR DELETE ON public."ImagingReport"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_imaging_report_immutability();

-- =============================================================================
-- FIN 33_imaging_hardening.sql
-- =============================================================================
