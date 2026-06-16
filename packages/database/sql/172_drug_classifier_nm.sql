-- =====================================================================
-- 172_drug_classifier_nm.sql
-- Mapeo N:M de clasificadores clínicos — Nivel 1 (guía GS1 El Salvador).
--
-- Permite que un medicamento (public."Drug") se mapee simultáneamente a
-- múltiples vocabularios controlados (ATC, SNOMED CT, UNSPSC, RxNorm, ...),
-- según el modelo tbl_Mapeo_Clinico_Estandar del estándar. El campo
-- Drug.atcCode (1:1) se conserva por compatibilidad.
--
-- RLS: catálogo de referencia clínica. SELECT abierto a authenticated;
--   escritura vía router admin-gated (requireRole) con rol BYPASSRLS.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public."DrugClassifier" (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "drugId"    uuid        NOT NULL REFERENCES public."Drug"(id) ON DELETE CASCADE,
  standard    text        NOT NULL
                CHECK (standard IN ('ATC','SNOMED','UNSPSC','RXNORM','CIE10','LOINC')),
  value       text        NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_drug_classifier UNIQUE ("drugId", standard, value)
);

CREATE INDEX IF NOT EXISTS idx_drug_classifier_drug    ON public."DrugClassifier" ("drugId");
CREATE INDEX IF NOT EXISTS idx_drug_classifier_std_val ON public."DrugClassifier" (standard, value);

ALTER TABLE public."DrugClassifier" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drug_classifier_select ON public."DrugClassifier";
CREATE POLICY drug_classifier_select ON public."DrugClassifier"
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public."DrugClassifier" IS
  'Mapeo N:M Drug ↔ vocabularios controlados (ATC/SNOMED/UNSPSC/RxNorm). '
  'Guía GS1 El Salvador Nivel 1 — clasificadores simultáneos.';
