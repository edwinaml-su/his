-- =============================================================================
-- 184_cc0008_pre_registro_patient_fields.sql
-- CC-0008 / REQ-ECE-PRE-001 — Pre-registro de paciente.
-- Propósito: adecuar el modelo Patient legacy (NO crear Paciente paralelo) con
--   los campos de nombre/apellido extendidos y el switch "trae documento" que el
--   formulario de pre-registro requiere:
--     - "thirdName"       → tercer nombre (3 nombres soportados).
--     - "marriedLastName" → apellido de casada (3 apellidos soportados).
--     - "traeDocumento"   → switch "el paciente trae documento de identidad"
--                           (default ON; OFF habilita registro sin documento).
-- Columnas en camelCase entrecomillado para empatar el naming que genera Prisma
--   (gotcha CLAUDE.md: SQL hand-rolled debe respetar las comillas).
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- traeDocumento es NOT NULL con DEFAULT true → las filas existentes adoptan el
--   default sin reescritura bloqueante (Postgres 11+).
-- Aplicar vía: Supabase SQL Editor o MCP execute_sql / apply_migration.
-- NO aplicar a prod directamente: aprobado por @Orq en el gate de entrega.
-- =============================================================================

ALTER TABLE "Patient"
  ADD COLUMN IF NOT EXISTS "thirdName"       varchar(120),
  ADD COLUMN IF NOT EXISTS "marriedLastName" varchar(120),
  ADD COLUMN IF NOT EXISTS "traeDocumento"   boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN "Patient"."thirdName"       IS 'CC-0008 §6 — tercer nombre.';
COMMENT ON COLUMN "Patient"."marriedLastName" IS 'CC-0008 §6 — apellido de casada.';
COMMENT ON COLUMN "Patient"."traeDocumento"   IS 'CC-0008 §6 — switch "el paciente trae documento de identidad" (default ON).';
