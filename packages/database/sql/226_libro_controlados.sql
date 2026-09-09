-- =============================================================================
-- 226_libro_controlados.sql
-- docs/48 Ola 4 (C4-4) — Libro de controlados (Ley Reguladora de Actividades
-- Relativas a las Drogas, El Salvador).
--
-- Antes de este archivo, `pharmacy.router.ts` (dispense.create) ya exigía
-- witnessUserId + controlledJustification para RX_CONTROLLED (Beta.2), pero
-- solo los dejaba como texto libre dentro de `notes`
-- ([CONTROLLED:...]/[witness:...]) — imposible de listar/filtrar como "libro"
-- exigible. Este SQL espeja en columnas reales lo que schema.prisma agrega al
-- modelo MedicationDispense; el router (Ola 4) sigue escribiendo también en
-- `notes` para no romper el formato legado.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
--
-- APLICADO a prod 2026-09-09 vía MCP (libro_controlados_226) — NO re-aplicar.
-- =============================================================================

ALTER TABLE public."MedicationDispense"
  ADD COLUMN IF NOT EXISTS "isControlled"            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "witnessUserId"            uuid,
  ADD COLUMN IF NOT EXISTS "controlledJustification"  varchar(500);

COMMENT ON COLUMN public."MedicationDispense"."isControlled" IS
  'docs/48 Ola 4 (C4-4) — true si drug.dispensingClass = RX_CONTROLLED al momento de dispensar. Filtro del libro de controlados.';

CREATE INDEX IF NOT EXISTS idx_medication_dispense_controlled
  ON public."MedicationDispense" ("isControlled", "dispensedAt")
  WHERE "isControlled" = true;

-- =============================================================================
-- Verificación manual post-apply:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'MedicationDispense'
--      AND column_name IN ('isControlled','witnessUserId','controlledJustification');
--   -- esperado: 3 filas
-- =============================================================================
