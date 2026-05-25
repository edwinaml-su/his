-- =============================================================================
-- 132_cost_center_clinical_modules.sql
-- Wave 10 — Integración módulos clínicos: propagar costCenterId.
-- Nullable + FK RESTRICT en 8 tablas clínicas que registran transacciones que
-- generan costo (spec NTEC §7). Sprint posterior puede backfill + NOT NULL.
--
-- Aplicado a prod 2026-05-25 vía MCP
-- (migration: cost_center_id_clinical_modules_2026_05_25).
-- =============================================================================

ALTER TABLE "Encounter"             ADD COLUMN IF NOT EXISTS "costCenterId" uuid;
ALTER TABLE "InpatientAdmission"    ADD COLUMN IF NOT EXISTS "costCenterId" uuid;
ALTER TABLE "Prescription"          ADD COLUMN IF NOT EXISTS "costCenterId" uuid;
ALTER TABLE "MedicationDispense"    ADD COLUMN IF NOT EXISTS "costCenterId" uuid;

ALTER TABLE "LabOrder"
  ADD COLUMN IF NOT EXISTS "costCenterId"        uuid,
  ADD COLUMN IF NOT EXISTS "ejecutorCostCenterId" uuid;

ALTER TABLE "ImagingOrder"
  ADD COLUMN IF NOT EXISTS "costCenterId"        uuid,
  ADD COLUMN IF NOT EXISTS "ejecutorCostCenterId" uuid;

ALTER TABLE "SurgeryCase" ADD COLUMN IF NOT EXISTS "costCenterId" uuid;

-- FKs RESTRICT (idempotente)
DO $$
DECLARE
  v_pairs text[][] := ARRAY[
    ARRAY['Encounter',          'costCenterId',         'encounter_cost_center_fkey'],
    ARRAY['InpatientAdmission', 'costCenterId',         'inpatient_admission_cost_center_fkey'],
    ARRAY['Prescription',       'costCenterId',         'prescription_cost_center_fkey'],
    ARRAY['MedicationDispense', 'costCenterId',         'medication_dispense_cost_center_fkey'],
    ARRAY['LabOrder',           'costCenterId',         'lab_order_cost_center_fkey'],
    ARRAY['LabOrder',           'ejecutorCostCenterId', 'lab_order_ejecutor_cost_center_fkey'],
    ARRAY['ImagingOrder',       'costCenterId',         'imaging_order_cost_center_fkey'],
    ARRAY['ImagingOrder',       'ejecutorCostCenterId', 'imaging_order_ejecutor_cost_center_fkey'],
    ARRAY['SurgeryCase',        'costCenterId',         'surgery_case_cost_center_fkey']
  ];
  v_pair text[];
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = v_pair[1] AND constraint_name = v_pair[3]
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES "CostCenter"(id) ON DELETE RESTRICT',
        v_pair[1], v_pair[3], v_pair[2]
      );
    END IF;
  END LOOP;
END $$;

-- Índices parciales (sólo WHERE NOT NULL)
CREATE INDEX IF NOT EXISTS idx_encounter_cc            ON "Encounter"          ("costCenterId") WHERE "costCenterId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inpatient_admission_cc  ON "InpatientAdmission" ("costCenterId") WHERE "costCenterId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prescription_cc         ON "Prescription"       ("costCenterId") WHERE "costCenterId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_medication_dispense_cc  ON "MedicationDispense" ("costCenterId") WHERE "costCenterId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_order_cc            ON "LabOrder"           ("costCenterId") WHERE "costCenterId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_order_ejec_cc       ON "LabOrder"           ("ejecutorCostCenterId") WHERE "ejecutorCostCenterId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imaging_order_cc        ON "ImagingOrder"       ("costCenterId") WHERE "costCenterId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imaging_order_ejec_cc   ON "ImagingOrder"       ("ejecutorCostCenterId") WHERE "ejecutorCostCenterId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_surgery_case_cc         ON "SurgeryCase"        ("costCenterId") WHERE "costCenterId" IS NOT NULL;
