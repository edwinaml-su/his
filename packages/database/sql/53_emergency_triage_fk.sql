-- UAT-BUG-01 — TDR §12.4: referencia al triage Manchester que habilita la admisión a Urgencias.
-- Agrega columna nullable + FK + índice a "EmergencyVisit".
-- Nullable para compatibilidad con visitas históricas creadas antes del fix.

ALTER TABLE "EmergencyVisit"
  ADD COLUMN IF NOT EXISTS "triageEvaluationId" UUID REFERENCES "TriageEvaluation"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "EmergencyVisit_triageEvaluationId_idx"
  ON "EmergencyVisit" ("triageEvaluationId");
