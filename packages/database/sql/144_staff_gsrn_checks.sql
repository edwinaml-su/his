-- =============================================================================
-- 144_staff_gsrn_checks.sql
-- HI-21 + HI-22: CHECK constraint GSRN-18 en ece.gs1_gsrn + columna motivo_revocacion
--
-- HI-22: sin CHECK constraint el GSRN puede ser cualquier texto — insercciones
--   directas (seed/backfill/migración) pueden registrar GSRNs inválidos que luego
--   producen errores en validación de badge.
-- HI-21: la columna motivo_revocacion no existía; el router staff-gsrn.revoke
--   intenta persistirla en un try/catch silencioso.
--
-- APLICAR: manualmente via Supabase SQL Editor o mcp__supabase__execute_sql.
-- NO correr prisma migrate dev — el flujo es schema.prisma + SQL numerados.
-- =============================================================================

-- HI-22: CHECK constraint que garantiza formato GSRN GS1 AI 8018 (18 dígitos numéricos).
-- La validación del dígito verificador vive en la capa Zod (gsrnSchema en contracts).
-- El CHECK en BD es la última barrera para inserciones directas.
ALTER TABLE ece.gs1_gsrn
  ADD CONSTRAINT chk_gsrn_formato
  CHECK (codigo ~ '^\d{18}$' AND length(codigo) = 18);

-- HI-21: columna motivo_revocacion para persistir el motivo de revocación de credenciales.
-- El router staff-gsrn.revoke ya intenta persistirlo (try/catch); esta migración
-- materializa la columna para que el motivo quede en la tabla además de en audit_log.
ALTER TABLE ece.gs1_gsrn
  ADD COLUMN IF NOT EXISTS motivo_revocacion TEXT;

-- Constraint: si el GSRN está inactivo (revocado), el motivo es obligatorio.
-- Permite NULLs mientras activo=true (aún habilitado).
ALTER TABLE ece.gs1_gsrn
  ADD CONSTRAINT chk_motivo_revocacion_si_inactivo
  CHECK (activo = true OR motivo_revocacion IS NOT NULL);

COMMENT ON CONSTRAINT chk_gsrn_formato ON ece.gs1_gsrn
  IS 'HI-22 (audit 2026-05-19): GSRN debe ser exactamente 18 dígitos numéricos (GS1 AI 8018).';

COMMENT ON CONSTRAINT chk_motivo_revocacion_si_inactivo ON ece.gs1_gsrn
  IS 'HI-21 (audit 2026-05-19): compliance — revocación de credenciales exige motivo documentado.';

COMMENT ON COLUMN ece.gs1_gsrn.motivo_revocacion
  IS 'HI-21: motivo de revocación del GSRN profesional. Obligatorio cuando activo=false.';
