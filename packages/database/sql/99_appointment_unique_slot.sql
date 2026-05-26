-- =============================================================================
-- 99_appointment_unique_slot.sql — K-15: UNIQUE constraint provider+slot
-- =============================================================================
-- Hallazgo: @@index([providerId, scheduledAt]) existe en schema.prisma pero
-- NO es único — dos pacientes pueden reservar el mismo slot del mismo médico.
-- Fix: UNIQUE constraint a nivel BD (no solo en aplicación).
--
-- PRECONDICIÓN: ejecutar verificación de duplicados antes de aplicar:
--   SELECT "providerId", "scheduledAt", COUNT(*)
--   FROM "OutpatientAppointment"
--   GROUP BY "providerId", "scheduledAt"
--   HAVING COUNT(*) > 1;
-- Si hay filas, limpiar primero y luego aplicar esta migración.
-- =============================================================================

ALTER TABLE "OutpatientAppointment"
  ADD CONSTRAINT outpatient_appointment_provider_slot_unique
  UNIQUE ("providerId", "scheduledAt");
