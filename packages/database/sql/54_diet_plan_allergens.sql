-- UAT-BUG-02: Agrega columna allergens a "DietPlan"
-- Alergenos declarados en el plan dietético para validación contra PatientAllergy.
-- Array de strings (texto libre, uppercase por convención en la aplicación).
-- Aplicar vía Supabase SQL Editor / mcp__supabase__apply_migration.

ALTER TABLE "DietPlan"
  ADD COLUMN IF NOT EXISTS "allergens" TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN "DietPlan"."allergens" IS
  'Alergenos declarados en el plan (e.g. {NUTS,DAIRY,GLUTEN}). '
  'Comparados en order.create contra PatientAllergy.substanceText (uppercase). '
  'UAT-BUG-02.';
