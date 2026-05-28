-- =============================================================================
-- Migration: 104_encounter_admission_fields.sql
-- H2-01 (audit Stream A — P1 ALTA): 5 campos de admisión capturados en el
-- wizard UI que no persistían en BD. El contrato Zod los definía pero el
-- router los descartaba silenciosamente (TODO Sprint 4 en código anterior).
--
-- PENDIENTE DE APPLY MANUAL en Supabase SQL Editor / MCP apply_migration.
-- =============================================================================

ALTER TABLE "Encounter"
  ADD COLUMN IF NOT EXISTS "chiefComplaint"         VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "accompanyingPersonName"  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "valuables"               JSONB,
  ADD COLUMN IF NOT EXISTS "isReferral"              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "referralOrigin"          VARCHAR(200);

COMMENT ON COLUMN "Encounter"."chiefComplaint"
  IS 'Motivo de consulta declarado en admisión (max 500 chars).';

COMMENT ON COLUMN "Encounter"."accompanyingPersonName"
  IS 'Nombre del acompañante / responsable legal al momento de la admisión.';

COMMENT ON COLUMN "Encounter"."valuables"
  IS 'Lista JSON de pertenencias declaradas por el paciente en admisión (["billetera","celular",...]).';

COMMENT ON COLUMN "Encounter"."isReferral"
  IS 'true si el paciente llega por referencia de otra institución.';

COMMENT ON COLUMN "Encounter"."referralOrigin"
  IS 'Nombre / código de la institución que emite la referencia.';
