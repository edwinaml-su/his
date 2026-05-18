-- =====================================================================
-- 91_bedside_validation.sql
-- Algoritmo 5 Correctos — Bedside Validation Log
--
-- US.F2.6.21-22 (Proceso E, Bedside Scanning).
-- Persiste cada invocación al algoritmo server-side como registro
-- inmutable para auditoría clínica y farmacovigilancia.
--
-- Tabla: ece.bedside_validation
--   - Cada validación queda con su resultado (OK | HARD_STOP)
--   - Hard stop incluye: cual correcto falló, qué se esperaba vs recibió
--   - RLS: tenant-scoped vía organization_id
--   - Inmutabilidad: trigger bloquea UPDATE/DELETE (igual que audit_log)
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, DROP/CREATE policies y trigger.
-- Aplicar vía mcp__supabase__apply_migration.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Tabla principal
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.bedside_validation (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,

  -- Contexto del acto clínico
  indication_id     text        NOT NULL,       -- ID de la indicación/MedicalOrder
  patient_id        uuid        NOT NULL,       -- FK al paciente del HIS
  nurse_gsrn        text        NOT NULL,       -- GSRN de la enfermera (AI 8018)
  patient_gsrn      text        NOT NULL,       -- GSRN del paciente (AI 8018)

  -- Datos GS1 del medicamento escaneado
  gtin              text        NOT NULL,       -- AI (01) 14 dígitos
  lote              text,                       -- AI (10) lote
  serie             text,                       -- AI (21) número de serie
  fecha_vence       date,                       -- AI (17) fecha de vencimiento

  -- Resultado del algoritmo
  status            text        NOT NULL
                    CHECK (status IN ('OK', 'HARD_STOP')),
  hard_stop_code    text,                       -- NULL si OK; ej. MEDICAMENTO_NO_COINCIDE
  hard_stop_reason  text,                       -- Descripción legible del error
  expected_value    text,                       -- Valor esperado (para diff en UI)
  received_value    text,                       -- Valor recibido del scan

  -- Contexto de ubicación (GLN del servicio donde ocurrió)
  gln_ubicacion     text,

  -- Metadatos
  executed_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Índices para consultas frecuentes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_bedside_validation_org
  ON ece.bedside_validation (organization_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bedside_validation_patient
  ON ece.bedside_validation (patient_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bedside_validation_indication
  ON ece.bedside_validation (indication_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bedside_validation_hard_stop
  ON ece.bedside_validation (organization_id, hard_stop_code)
  WHERE status = 'HARD_STOP';

-- ---------------------------------------------------------------------------
-- Inmutabilidad: bloquear UPDATE/DELETE (igual al patrón audit_log)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.bedside_validation_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'bedside_validation es inmutable: no se permite % en esta tabla.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_bedside_validation_immutable ON ece.bedside_validation;
CREATE TRIGGER trg_bedside_validation_immutable
  BEFORE UPDATE OR DELETE ON ece.bedside_validation
  FOR EACH ROW EXECUTE FUNCTION ece.bedside_validation_immutable();

-- ---------------------------------------------------------------------------
-- RLS — tenant-scoped
-- ---------------------------------------------------------------------------

ALTER TABLE ece.bedside_validation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bedside_validation_select ON ece.bedside_validation;
CREATE POLICY bedside_validation_select
  ON ece.bedside_validation FOR SELECT
  TO authenticated
  USING (organization_id = (current_setting('app.current_org_id', true)::uuid));

DROP POLICY IF EXISTS bedside_validation_insert ON ece.bedside_validation;
CREATE POLICY bedside_validation_insert
  ON ece.bedside_validation FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = (current_setting('app.current_org_id', true)::uuid));

-- ---------------------------------------------------------------------------
-- Comentarios
-- ---------------------------------------------------------------------------

COMMENT ON TABLE  ece.bedside_validation                IS 'Log inmutable del algoritmo 5 Correctos bedside (US.F2.6.21-22)';
COMMENT ON COLUMN ece.bedside_validation.hard_stop_code IS 'Código del correcto que falló: PACIENTE_NO_COINCIDE | MEDICAMENTO_NO_COINCIDE | DOSIS_INCORRECTA | VIA_INCORRECTA | FUERA_DE_VENTANA';
COMMENT ON COLUMN ece.bedside_validation.expected_value IS 'Valor esperado según la indicación médica activa';
COMMENT ON COLUMN ece.bedside_validation.received_value IS 'Valor recibido del DataMatrix escaneado';
