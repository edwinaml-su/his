-- Migración 112: CHECKs de formato GS1 en ece.bedside_validation (BCMA-003)
--
-- Garantiza que nurse_gsrn / patient_gsrn sean GSRN-18 (18 dígitos) y
-- gtin sea GTIN-14 (14 dígitos) a nivel de base de datos, impidiendo que
-- cualquier string arbitrario supere la validación de la capa de aplicación.
--
-- Idempotente: usa el bloque DO/EXCEPTION para ignorar "duplicate_object".
-- Aplicar vía Supabase SQL Editor o mcp__supabase__apply_migration.
-- Los constraints ya fueron creados en la BD del proyecto. Este archivo
-- documenta la migración para reproducibilidad en entornos nuevos.

DO $$
BEGIN
  ALTER TABLE ece.bedside_validation
    ADD CONSTRAINT chk_nurse_gsrn CHECK (nurse_gsrn ~ '^\d{18}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ece.bedside_validation
    ADD CONSTRAINT chk_patient_gsrn CHECK (patient_gsrn ~ '^\d{18}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ece.bedside_validation
    ADD CONSTRAINT chk_gtin CHECK (gtin ~ '^\d{14}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
