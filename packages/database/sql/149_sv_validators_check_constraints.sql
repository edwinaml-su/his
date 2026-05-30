-- =============================================================================
-- HIS Multi-país | CHECK constraints DUI / NIT / NIE en PatientIdentifier
-- Cierra hallazgo BD P0-3 — auditoría 2026-05-30_bd_security_audit.md
--
-- Contexto:
--   Las funciones validate_dui(), validate_nit(), validate_nie() ya existen en
--   public (sql/03_validations_sv.sql, IMMUTABLE). El trigger
--   trg_validate_patient_identifier también existe (BEFORE INSERT OR UPDATE).
--
--   El problema es que un INSERT directo vía service_role o SQL Editor (que
--   bypasea triggers con SET session_replication_role = replica, o directamente
--   si el trigger es deshabilitado) acepta IDs inválidos. Los CHECK constraints
--   son enforceados por el motor de Postgres independientemente de los triggers
--   y no pueden ser bypasseados por service_role a menos que se deshabiliten
--   explícitamente (ALTER TABLE DISABLE TRIGGER vs ALTER TABLE DROP CONSTRAINT
--   son operaciones distintas y auditables).
--
-- Patrón NOT VALID + VALIDATE:
--   NOT VALID: el constraint se agrega sin escanear las filas existentes,
--   evitando un lock prolongado en tabla con registros actuales.
--   VALIDATE CONSTRAINT: escanea con ShareUpdateExclusiveLock (no bloquea
--   lecturas ni INSERTs) y marca el constraint como confiable para el planner.
--
-- Si VALIDATE falla hay filas inválidas pre-existentes. En ese caso:
--   1. Identificarlas: SELECT * FROM "PatientIdentifier" WHERE kind='DUI'
--      AND NOT public.validate_dui(value);
--   2. Corregirlas o marcarlas como inválidas en la aplicación.
--   3. Re-ejecutar VALIDATE.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. DUI — Documento Único de Identidad (RNPN El Salvador)
--    Aplica solo a filas donde kind = 'DUI'. Permite NULL (pacientes sin DUI).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public."PatientIdentifier"
  ADD CONSTRAINT ck_patient_identifier_dui_valid
  CHECK (kind::text <> 'DUI' OR public.validate_dui(value))
  NOT VALID;

ALTER TABLE public."PatientIdentifier"
  VALIDATE CONSTRAINT ck_patient_identifier_dui_valid;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. NIT — Número de Identificación Tributaria (Min. Hacienda SV)
--    Aplica solo a filas donde kind = 'NIT'. Permite NULL.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public."PatientIdentifier"
  ADD CONSTRAINT ck_patient_identifier_nit_valid
  CHECK (kind::text <> 'NIT' OR public.validate_nit(value))
  NOT VALID;

ALTER TABLE public."PatientIdentifier"
  VALIDATE CONSTRAINT ck_patient_identifier_nit_valid;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. NIE — Número de Identificación de Extranjero (Min. Hacienda SV)
--    Aplica solo a filas donde kind = 'NIE'. Permite NULL.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public."PatientIdentifier"
  ADD CONSTRAINT ck_patient_identifier_nie_valid
  CHECK (kind::text <> 'NIE' OR public.validate_nie(value))
  NOT VALID;

ALTER TABLE public."PatientIdentifier"
  VALIDATE CONSTRAINT ck_patient_identifier_nie_valid;

-- ─────────────────────────────────────────────────────────────────────────
-- Verificación post-apply (dejar comentado, correr manualmente):
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname LIKE 'ck_patient_identifier_%'
-- ORDER BY conname;
-- ─────────────────────────────────────────────────────────────────────────
