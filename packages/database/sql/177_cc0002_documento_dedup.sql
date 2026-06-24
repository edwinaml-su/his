-- =============================================================================
-- 177_cc0002_documento_dedup.sql
-- CC-0002 Sprint B — Tipo de documento de registro + deduplicación
-- Propósito: Agrega el enum DocumentType, columnas documentType/documentNumber
--   en public."Patient", e índice único parcial para dedup de documentos propios
--   (DUI, DNI, PASAPORTE) por organización. DUI_RESP es compartible → excluido
--   del índice único. Sin backfill: pacientes existentes quedan con NULL hasta edición.
-- Idempotente: usa IF NOT EXISTS / DO $$ guard.
-- Aplicar vía: Supabase SQL Editor o MCP execute_sql / apply_migration.
-- =============================================================================

-- 1. Crear enum DocumentType (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'DocumentType' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    CREATE TYPE public."DocumentType" AS ENUM ('DUI', 'DNI', 'PASAPORTE', 'DUI_RESP');
  END IF;
END
$$;

-- 2. Agregar columnas en Patient (idempotente).
ALTER TABLE public."Patient"
  ADD COLUMN IF NOT EXISTS "documentType"   public."DocumentType",
  ADD COLUMN IF NOT EXISTS "documentNumber" varchar(40);

-- 3. Índice único parcial: documentos propios 1:1 por organización.
--    DUI_RESP se excluye intencionalmente (un responsable puede figurar en
--    múltiples menores, CC-0002 §5).
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_documento_propio
  ON public."Patient" ("organizationId", "documentType", "documentNumber")
  WHERE "documentType" IN ('DUI', 'DNI', 'PASAPORTE') AND "documentNumber" IS NOT NULL;
