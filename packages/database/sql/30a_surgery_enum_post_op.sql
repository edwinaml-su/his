-- =============================================================================
-- §13 Surgery — 30a: ADD VALUE 'POST_OP' al enum SurgeryCaseStatus
--
-- Este script DEBE correrse SOLO en una transacción (Supabase SQL Editor lo
-- envuelve automáticamente). El nuevo valor del enum solo se vuelve usable
-- DESPUÉS del COMMIT, por eso 30b (que usa POST_OP en CREATE INDEX) debe
-- ejecutarse en una pestaña separada.
--
-- Idempotente.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'SurgeryCaseStatus' AND e.enumlabel = 'POST_OP'
  ) THEN
    ALTER TYPE public."SurgeryCaseStatus" ADD VALUE 'POST_OP' BEFORE 'COMPLETED';
  END IF;
END $$;

-- Verificación:
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
--   WHERE t.typname='SurgeryCaseStatus' ORDER BY e.enumsortorder;
--   -- Debe incluir POST_OP entre IN_PROGRESS y COMPLETED.
