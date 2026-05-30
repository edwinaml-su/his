-- =============================================================================
-- Migración 153: LASA acknowledgement bloqueante en MedicationAdministration
-- JCI Standard: IPSG.3-H1 (US-21-D4)
--
-- Problema: la alerta LASA ya existe en UI (toast) pero no deja trazabilidad
-- en BD. El surveyor JCI rechaza "alerta sin trazabilidad auditable".
--
-- Solución: 3 columnas en "MedicationAdministration":
--   lasa_ack_at     → timestamp del acknowledgement
--   lasa_ack_by     → FK al User que reconoció el riesgo LASA
--   lasa_ack_reason → razón clínica (obligatoria cuando el drug es LASA)
-- =============================================================================

-- ─── 1. Columnas LASA ack ────────────────────────────────────────────────────
ALTER TABLE "MedicationAdministration"
  ADD COLUMN IF NOT EXISTS lasa_ack_at     timestamptz,
  ADD COLUMN IF NOT EXISTS lasa_ack_by     uuid,
  ADD COLUMN IF NOT EXISTS lasa_ack_reason varchar(500);

-- ─── 2. FK a User (quien reconoció el LASA) ──────────────────────────────────
-- Solo añadir si la columna existe y la FK no está ya definida.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'MedicationAdministration_lasa_ack_by_fkey'
  ) THEN
    ALTER TABLE "MedicationAdministration"
      ADD CONSTRAINT "MedicationAdministration_lasa_ack_by_fkey"
      FOREIGN KEY (lasa_ack_by)
      REFERENCES "User"(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── 3. Índice condicional: solo filas con LASA ack (sparse index) ────────────
CREATE INDEX IF NOT EXISTS "MedicationAdministration_lasa_ack_at_idx"
  ON "MedicationAdministration" (lasa_ack_at)
  WHERE lasa_ack_at IS NOT NULL;

-- ─── 4. Verificación ─────────────────────────────────────────────────────────
-- Confirmar que las 3 columnas existen.
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) = 3
      FROM information_schema.columns
     WHERE table_name = 'MedicationAdministration'
       AND column_name IN ('lasa_ack_at', 'lasa_ack_by', 'lasa_ack_reason')
  ), 'ERROR: No se encontraron las 3 columnas LASA ack en MedicationAdministration';
  RAISE NOTICE 'OK: columnas LASA ack verificadas en MedicationAdministration';
END $$;
