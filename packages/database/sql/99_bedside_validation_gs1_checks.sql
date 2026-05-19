-- =============================================================================
-- 99_bedside_validation_gs1_checks.sql
-- BCMA-003: CHECK constraints de formato GS1 en ece.bedside_validation.
--
-- Hallazgo: nurse_gsrn, patient_gsrn y gtin son TEXT NOT NULL sin validación
-- de formato en BD. Los validators validateGSRN/validateGTIN existen en
-- packages/contracts/src/validators/gs1.ts pero no estaban reflejados en BD.
--
-- Pre-check ejecutado: SELECT COUNT(*) FROM ece.bedside_validation = 0.
-- Tabla vacía → VALIDATE CONSTRAINT ejecutará sin errores.
--
-- Decisión: usar regex de longitud únicamente (no checksum) para alinear con
-- el nivel mínimo que la BD puede validar sin UDF. El checksum GS1 módulo-10
-- permanece en capa de aplicación (validators/gs1.ts).
-- =============================================================================

BEGIN;

-- nurse_gsrn: GSRN-18 = exactamente 18 dígitos numéricos.
ALTER TABLE ece.bedside_validation
  ADD CONSTRAINT chk_nurse_gsrn
    CHECK (nurse_gsrn ~ '^\d{18}$');

-- patient_gsrn: ídem.
ALTER TABLE ece.bedside_validation
  ADD CONSTRAINT chk_patient_gsrn
    CHECK (patient_gsrn ~ '^\d{18}$');

-- gtin: GTIN-14 = exactamente 14 dígitos numéricos.
ALTER TABLE ece.bedside_validation
  ADD CONSTRAINT chk_gtin
    CHECK (gtin ~ '^\d{14}$');

COMMIT;
