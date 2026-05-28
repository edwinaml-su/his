-- =============================================================================
-- Migration: 107_medication_administration_scan_checks.sql
-- BCMA-004 (audit Stream B — P1 ALTA): public.MedicationAdministration tiene
-- patientBarcodeScanned, drugBarcodeScanned, providerBadgeScanned como
-- BOOLEAN DEFAULT false sin CHECK que exija que los 3 sean true cuando
-- status = 'GIVEN' o 'ADMINISTERED'. El trigger de inmutabilidad post-
-- ADMINISTERED ya existe (tr_emar_immutable_post_administered) pero no
-- valida los scans antes de persistir.
--
-- GS1 GSRN: gsrnPaciente, gsrnEnfermera son VARCHAR(20) nullable sin CHECK
-- de formato. Los campos de bedside scan (gtinScanned, loteScanned, etc.)
-- son VARCHAR opcionales para compatibilidad con admin manual legacy — no
-- se fuerzan NOT NULL porque la vía legacy sigue siendo válida.
--
-- PENDIENTE DE APPLY MANUAL en Supabase SQL Editor / MCP apply_migration.
-- =============================================================================

-- ─── CHECK: los 3 scans deben ser true cuando status = GIVEN/ADMINISTERED ───

ALTER TABLE "MedicationAdministration"
  DROP CONSTRAINT IF EXISTS "chk_bcma_scans_on_given";

ALTER TABLE "MedicationAdministration"
  ADD CONSTRAINT "chk_bcma_scans_on_given"
  CHECK (
    status NOT IN ('GIVEN', 'ADMINISTERED') OR (
      "patientBarcodeScanned" = TRUE
      AND "drugBarcodeScanned"   = TRUE
      AND "providerBadgeScanned" = TRUE
    )
  );

COMMENT ON CONSTRAINT "chk_bcma_scans_on_given" ON "MedicationAdministration"
  IS 'BCMA-004: los 3 scans BCMA deben confirmarse antes de registrar status GIVEN/ADMINISTERED.';

-- ─── CHECK: formato GSRN-18 (18 dígitos) cuando los campos están presentes ──
-- gsrnPaciente y gsrnEnfermera son opcionales (puede administrarse manualmente
-- sin escáner GS1), pero si se capturan deben tener formato válido.

-- NOTA: las columnas GS1 (gsrn_paciente, gsrn_enfermera, gtin_scanned,
-- lote_scanned, serie_scanned) están en snake_case en BD aunque los booleanos
-- de scan (*BarcodeScanned, *BadgeScanned) están en camelCase. Mixto histórico
-- del schema; respetamos los nombres reales detectados via information_schema.
ALTER TABLE "MedicationAdministration"
  DROP CONSTRAINT IF EXISTS "chk_med_admin_gsrn_paciente";

ALTER TABLE "MedicationAdministration"
  ADD CONSTRAINT "chk_med_admin_gsrn_paciente"
  CHECK (
    gsrn_paciente IS NULL OR gsrn_paciente ~ '^\d{18}$'
  );

ALTER TABLE "MedicationAdministration"
  DROP CONSTRAINT IF EXISTS "chk_med_admin_gsrn_enfermera";

ALTER TABLE "MedicationAdministration"
  ADD CONSTRAINT "chk_med_admin_gsrn_enfermera"
  CHECK (
    gsrn_enfermera IS NULL OR gsrn_enfermera ~ '^\d{18}$'
  );

-- ─── CHECK: formato GTIN-14 (14 dígitos) cuando gtin_scanned está presente ───

ALTER TABLE "MedicationAdministration"
  DROP CONSTRAINT IF EXISTS "chk_med_admin_gtin_scanned";

ALTER TABLE "MedicationAdministration"
  ADD CONSTRAINT "chk_med_admin_gtin_scanned"
  CHECK (
    gtin_scanned IS NULL OR gtin_scanned ~ '^\d{14}$'
  );

COMMENT ON CONSTRAINT "chk_med_admin_gsrn_paciente" ON "MedicationAdministration"
  IS 'BCMA-004: GSRN paciente debe tener 18 dígitos (GS1 GSRN-18).';

COMMENT ON CONSTRAINT "chk_med_admin_gsrn_enfermera" ON "MedicationAdministration"
  IS 'BCMA-004: GSRN enfermera debe tener 18 dígitos (GS1 GSRN-18).';

COMMENT ON CONSTRAINT "chk_med_admin_gtin_scanned" ON "MedicationAdministration"
  IS 'BCMA-004: GTIN escaneado debe tener 14 dígitos (GS1 GTIN-14).';
