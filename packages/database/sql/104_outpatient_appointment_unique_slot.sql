-- =============================================================================
-- 104_outpatient_appointment_unique_slot.sql — K-15: UNIQUE slot provider+scheduledAt
-- =============================================================================
-- El modelo schema.prisma ya tiene @@unique([providerId, scheduledAt]).
-- Este SQL aplica el equivalente a nivel BD como UNIQUE constraint.
--
-- El SQL 99_appointment_unique_slot.sql aplica ADD CONSTRAINT directamente.
-- Este archivo usa CREATE UNIQUE INDEX IF NOT EXISTS para ser idempotente y
-- no bloquear escrituras concurrentes durante la aplicación.
--
-- PRECONDICIÓN: verificar duplicados antes de aplicar:
--   SELECT "providerId", "scheduledAt", COUNT(*)
--   FROM "OutpatientAppointment"
--   GROUP BY "providerId", "scheduledAt"
--   HAVING COUNT(*) > 1;
-- Si hay filas, limpiar primero.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS outpatient_appointment_provider_slot_unique_idx
  ON "OutpatientAppointment" ("providerId", "scheduledAt")
  WHERE "deletedAt" IS NULL;
