-- 59_medadminstatus_align_enum.sql
-- Schema drift descubierto en /tareas (workflow-inbox.router): el enum
-- "MedAdminStatus" en BD productiva solo tiene GIVEN/HELD/REFUSED/MISSED/
-- DOCUMENTED_LATE/CANCELED, pero el schema.prisma declara también SCHEDULED
-- y ADMINISTERED. El router filtra `status: "SCHEDULED"` y Postgres responde:
--
--   22P02 invalid input value for enum "MedAdminStatus": "SCHEDULED"
--
-- Fix: alinear la BD con schema.prisma. `ALTER TYPE ... ADD VALUE IF NOT
-- EXISTS` es idempotente y NO requiere rewrite de tablas — solo agrega los
-- labels al catálogo del enum.
--
-- Semántica de los valores agregados:
--   SCHEDULED    → dosis programada, aún no administrada (estado inicial).
--   ADMINISTERED → dosis administrada (legacy; el set canónico actual usa
--                  GIVEN, pero mantenemos compatibilidad con el schema TS).
--
-- Limitación de Postgres: ADD VALUE no puede usarse en la misma transacción
-- que lo consuma. Por eso este archivo NO envuelve los ALTER en BEGIN/COMMIT.

ALTER TYPE "MedAdminStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "MedAdminStatus" ADD VALUE IF NOT EXISTS 'ADMINISTERED';
