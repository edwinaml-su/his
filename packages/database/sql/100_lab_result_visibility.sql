-- =============================================================================
-- 100_lab_result_visibility.sql — K-16: campos confidential/showInPortal en LabResult
-- =============================================================================
-- Hallazgo: todos los resultados validados son visibles al paciente en portal,
-- incluso resultados oncológicos/HIV/salud mental que requieren counseling previo.
-- Fix: dos columnas para control granular de visibilidad en portal del paciente.
--
-- Defaults preservan comportamiento actual para datos legacy:
--   confidential = false  → ningún resultado existente queda bloqueado
--   showInPortal = true   → todos los resultados existentes siguen visibles
-- La gate dura entra solo cuando el médico marque confidential=true
-- (p.ej. resultados HIV, oncológicos, salud mental).
-- =============================================================================

ALTER TABLE "LabResult"
  ADD COLUMN IF NOT EXISTS "confidential" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "showInPortal"  BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "LabResult"."confidential" IS
  'Resultado requiere counseling previo antes de liberarse al paciente (HIV, oncológico, salud mental). Cuando true, el portal NO muestra el resultado aunque showInPortal=true.';

COMMENT ON COLUMN "LabResult"."showInPortal" IS
  'Controla visibilidad en portal del paciente. Default true para comportamiento legacy. Puede ponerse false para resultados preliminares o con notas internas.';

-- Índice parcial: acelera la query del portal que filtra resultados visibles.
-- La mayoría de resultados serán confidential=false, por lo que el índice es pequeño.
CREATE INDEX IF NOT EXISTS lab_result_confidential_idx
  ON "LabResult" ("confidential")
  WHERE "confidential" = true;
