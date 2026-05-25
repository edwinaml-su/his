-- =============================================================================
-- Migration: 116_high_alert_medications.sql
-- JCI Standard: IPSG.3 ME 1 — High-Alert Medications
-- ISMP (Institute for Safe Medication Practices) classification
-- =============================================================================

ALTER TABLE "Drug"
  ADD COLUMN IF NOT EXISTS "alertLevel" TEXT NOT NULL DEFAULT 'standard'
  CHECK ("alertLevel" IN ('standard', 'high', 'very_high', 'critical'));

ALTER TABLE "Drug"
  ADD COLUMN IF NOT EXISTS "alertRationale" TEXT;

-- -----------------------------------------------------------------------------
-- Clasificación inicial según lista ISMP High-Alert Medications
-- ATC codes según OMS. Solo afecta registros ya sembrados.
-- -----------------------------------------------------------------------------

-- Insulinas (A10A*)
UPDATE "Drug"
  SET "alertLevel"     = 'high',
      "alertRationale" = 'ISMP High-Alert: insulin — hypoglycemia risk'
  WHERE "atcCode" LIKE 'A10A%';

-- Anticoagulantes: heparina, warfarina, HBPM (B01A*)
UPDATE "Drug"
  SET "alertLevel"     = 'high',
      "alertRationale" = 'ISMP High-Alert: anticoagulants (heparin/warfarin/LMWH) — bleeding risk'
  WHERE "atcCode" LIKE 'B01A%';

-- Opioides (N02A*)
UPDATE "Drug"
  SET "alertLevel"     = 'very_high',
      "alertRationale" = 'ISMP High-Alert: opioids — respiratory depression, addiction risk'
  WHERE "atcCode" LIKE 'N02A%';

-- KCl concentrado (B05XA01) — nunca IV directo sin diluir
UPDATE "Drug"
  SET "alertLevel"     = 'critical',
      "alertRationale" = 'ISMP: concentrated potassium chloride — fatal if administered undiluted IV'
  WHERE "atcCode" = 'B05XA01';

-- Citostáticos / antineoplásicos (L01*)
UPDATE "Drug"
  SET "alertLevel"     = 'very_high',
      "alertRationale" = 'ISMP High-Alert: antineoplastic agents — narrow therapeutic index, cytotoxic'
  WHERE "atcCode" LIKE 'L01%'
    AND "alertLevel" = 'standard';

-- Neurobloqueantes neuromusculares (M03A*)
UPDATE "Drug"
  SET "alertLevel"     = 'very_high',
      "alertRationale" = 'ISMP High-Alert: neuromuscular blocking agents — respiratory arrest risk'
  WHERE "atcCode" LIKE 'M03A%'
    AND "alertLevel" = 'standard';

-- Índice para filtrado rápido por nivel de alerta
CREATE INDEX IF NOT EXISTS "Drug_alertLevel_idx" ON "Drug" ("alertLevel");
