-- 92_medication_administration_bcma.sql
-- US.F2.6.31-33 — Extiende MedicationAdministration con campos BCMA bedside
-- y agrega status CANCELED al enum para soportar cancelación de enfermería.
--
-- Separado en pasos para respetar la restricción Postgres de no mezclar
-- ALTER TYPE ADD VALUE con CREATE INDEX en la misma transacción.
--
-- Paso A: nuevo valor del enum (no puede estar en transacción con DDL posterior)
-- Paso B: columnas nuevas + índices

-- ============================================================
-- PASO A — Enum extension
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public."MedAdminStatus"'::regtype
      AND enumlabel = 'CANCELED'
  ) THEN
    ALTER TYPE public."MedAdminStatus" ADD VALUE 'CANCELED';
  END IF;
END $$;

-- ============================================================
-- PASO B — Columnas BCMA + índices (pueden ir en tx separada)
-- ============================================================
ALTER TABLE public."MedicationAdministration"
  ADD COLUMN IF NOT EXISTS bedside_validation_id UUID,
  ADD COLUMN IF NOT EXISTS gtin_scanned         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS lote_scanned         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS serie_scanned        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS gsrn_paciente        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS gsrn_enfermera       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS gln_ubicacion        VARCHAR(15),
  ADD COLUMN IF NOT EXISTS cancel_reason        VARCHAR(500),
  ADD COLUMN IF NOT EXISTS canceled_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canceled_by_id       UUID;

-- Índice para consultas de kardex por paciente vía prescription
CREATE INDEX IF NOT EXISTS "MedAdmin_bedsideValidationId_idx"
  ON public."MedicationAdministration" (bedside_validation_id)
  WHERE bedside_validation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS "MedAdmin_gtinScanned_idx"
  ON public."MedicationAdministration" (gtin_scanned)
  WHERE gtin_scanned IS NOT NULL;

-- Índice compuesto para listByPatient con filtro de fecha
-- (se accede por prescriptionItemId que tiene FK→PrescriptionItem→patientId)
CREATE INDEX IF NOT EXISTS "MedAdmin_orgId_administeredAt_status_idx"
  ON public."MedicationAdministration" ("organizationId", "administeredAt", status);
