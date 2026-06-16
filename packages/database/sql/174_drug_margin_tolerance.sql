-- =====================================================================
-- 174_drug_margin_tolerance.sql
-- Margen de tolerancia terapéutica — Nivel 1 (guía GS1 El Salvador).
--
-- Campo Margen_Tolerancia del Catálogo Clínico: desviación terapéutica
-- permitida para compras (ej. +/- 50 mg) sin comprometer el estándar.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

ALTER TABLE public."Drug"
  ADD COLUMN IF NOT EXISTS margin_tolerance      numeric(12,4),
  ADD COLUMN IF NOT EXISTS margin_tolerance_unit varchar(20);

COMMENT ON COLUMN public."Drug".margin_tolerance IS
  'Desviación terapéutica permitida para compras (guía GS1 El Salvador Nivel 1, ej. 50).';
COMMENT ON COLUMN public."Drug".margin_tolerance_unit IS
  'Unidad del margen de tolerancia (mg, ml, %, ...).';
