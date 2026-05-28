-- =============================================================================
-- 105_lab_result_portal_visibility.sql — K-16: campos confidential/showInPortal
-- =============================================================================
-- El SQL 100_lab_result_visibility.sql aplica los campos.
-- Este archivo es idempotente con IF NOT EXISTS y agrega el índice parcial
-- para acelerar las queries del portal que filtran resultados visibles.
--
-- Defaults preservan comportamiento legacy:
--   confidential = false  → ningún resultado existente bloqueado
--   showInPortal = true   → todos los resultados existentes visibles
-- =============================================================================

ALTER TABLE "LabResult"
  ADD COLUMN IF NOT EXISTS "confidential" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "showInPortal"  BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "LabResult"."confidential" IS
  'K-16: resultado requiere counseling previo (HIV, oncológico, salud mental). Cuando true, portal NO muestra aunque showInPortal=true.';

COMMENT ON COLUMN "LabResult"."showInPortal" IS
  'K-16: visibilidad en portal del paciente. Default true para compatibilidad con datos legacy.';

-- Índice parcial para resultados confidenciales (subconjunto pequeño).
CREATE INDEX IF NOT EXISTS lab_result_portal_visibility_idx
  ON "LabResult" ("showInPortal", "confidential")
  WHERE "showInPortal" = true AND "confidential" = false;
