-- =============================================================================
-- §Farmacia — 232b: columnas de cierre de ciclo en "PharmacyReservation"
-- (RN-HIS-BOT-001 — devolución post-despacho / cierre por administración).
--
-- Requiere que 232a (ADD VALUE 'ADMINISTERED'/'RETURNED') ya esté COMMITEADO
-- — este archivo no usa los valores nuevos del enum en un CHECK, pero el
-- índice parcial de abajo filtra por los valores YA EXISTENTES (RESERVED/
-- CONFIRMED/DISPATCHED), así que no depende de 232a en sentido estricto; se
-- numera después de todos modos porque es la misma feature.
--
-- Hallazgo documentado en conciliacion-cargos.router.ts (líneas 16-21) y
-- confirmado en dispensation.router.ts: el flujo real (reserveItem) SOLO
-- crea reservas en estado RESERVED — nunca transiciona a CONFIRMED/DISPATCHED
-- (no existe ese paso intermedio en el sistema hoy). Además, al aplicar 232a
-- se confirmó que el enum en prod NUNCA tuvo el valor 'CONFIRMED' (drift vs
-- schema.prisma) — el índice parcial de abajo cubre solo RESERVED/DISPATCHED.
--
-- APLICADO a prod (ejacvsgbewcerxtjtwto) 2026-09-11 — NO re-aplicar.
--
-- Idempotente.
-- =============================================================================

ALTER TABLE "PharmacyReservation"
  ADD COLUMN IF NOT EXISTS "closeReason" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "closeNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "closedBy" UUID,
  ADD COLUMN IF NOT EXISTS "returnWitnessUserId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_pharmacyreservation_close_reason'
  ) THEN
    ALTER TABLE "PharmacyReservation"
      ADD CONSTRAINT chk_pharmacyreservation_close_reason
      CHECK ("closeReason" IS NULL OR "closeReason" IN (
        'NO_ADMINISTRADO', 'ALTA', 'INCUMPLIMIENTO', 'VENCIMIENTO', 'OTRO'
      ));
  END IF;
END $$;

-- Índice parcial: reservas "abiertas" (dispensadas pero sin cierre) —
-- acelera la conciliación (despachadoSinCierre) y el bloqueo de cierre de
-- cuenta (6ª causa, DISPENSACION_SIN_CIERRE).
CREATE INDEX IF NOT EXISTS idx_pharmacyreservation_open
  ON "PharmacyReservation" ("organizationId", "patientId", status)
  WHERE status IN ('RESERVED', 'DISPATCHED');

-- Verificación:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'PharmacyReservation'
--     AND column_name IN ('closeReason','closeNotes','closedAt','closedBy','returnWitnessUserId');
--   -- Debe devolver las 5 filas.
--   SELECT indexname FROM pg_indexes WHERE tablename = 'PharmacyReservation';
--   -- Debe incluir idx_pharmacyreservation_open.
