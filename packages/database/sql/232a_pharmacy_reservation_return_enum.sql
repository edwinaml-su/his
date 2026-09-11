-- =============================================================================
-- §Farmacia — 232a: ADD VALUE 'ADMINISTERED' / 'RETURNED' al enum
-- PharmacyReservationStatus (RN-HIS-BOT-001 — devolución post-despacho cierra
-- el ciclo de la requisición).
--
-- APLICADO a prod (ejacvsgbewcerxtjtwto) 2026-09-11 — NO re-aplicar.
--
-- Hallazgo de drift (verificado al aplicar este archivo): el enum real en
-- prod NUNCA tuvo el valor 'CONFIRMED' que sí declara schema.prisma —
-- `SELECT enumlabel ... WHERE typname='PharmacyReservationStatus'` devolvió
-- RESERVED/DISPATCHED/EXPIRED/CANCELLED (4 valores), no los 5 del schema.
-- Confirma, con un dato adicional, el hallazgo ya documentado en
-- conciliacion-cargos.router.ts: el flujo real solo crea/usa RESERVED.
-- 232b NO usa CONFIRMED en su índice parcial por este motivo.
--
-- Lección 30a/30b (docs CLAUDE.md §Gotchas): ALTER TYPE ... ADD VALUE no
-- puede co-existir con el USO del valor nuevo (CHECK constraint, índice,
-- WHERE) en la MISMA transacción. Este archivo SOLO agrega los 2 valores —
-- las columnas/índices que los referencian van en 232b, ejecutado DESPUÉS
-- (pestaña separada) para que el COMMIT de este archivo ya esté firme.
--
-- Idempotente.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'PharmacyReservationStatus' AND e.enumlabel = 'ADMINISTERED'
  ) THEN
    ALTER TYPE public."PharmacyReservationStatus" ADD VALUE 'ADMINISTERED';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'PharmacyReservationStatus' AND e.enumlabel = 'RETURNED'
  ) THEN
    ALTER TYPE public."PharmacyReservationStatus" ADD VALUE 'RETURNED';
  END IF;
END $$;

-- Verificación:
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
--   WHERE t.typname='PharmacyReservationStatus' ORDER BY e.enumsortorder;
--   -- Debe incluir ADMINISTERED y RETURNED además de los 5 valores originales.
