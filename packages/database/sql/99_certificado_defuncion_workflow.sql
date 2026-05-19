-- B-01 (S2-Tier4): Agregar columnas de workflow a ece.certificado_defuncion
-- NTEC Art. 40 — inmutabilidad post-firma; Art. 21 — certificado defunción.
-- Aplicado a Supabase: 2026-05-19

ALTER TABLE ece.certificado_defuncion
  ADD COLUMN IF NOT EXISTS estado_workflow     TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado_workflow IN ('borrador','firmado','validado','certificado','anulado')),
  ADD COLUMN IF NOT EXISTS firmado_en          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validado_en         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS certificado_en      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anulado_en          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payload_hash        TEXT,
  ADD COLUMN IF NOT EXISTS medico_firmante_id  UUID REFERENCES auth.users(id);

-- Trigger inmutabilidad: bloquea UPDATE/DELETE una vez el certificado pasa de borrador.
CREATE OR REPLACE FUNCTION ece.fn_bloquea_mutacion_certdef() RETURNS trigger AS $$
BEGIN
  IF OLD.estado_workflow IN ('firmado','validado','certificado','anulado') THEN
    RAISE EXCEPTION 'mutacion_no_permitida: certificado defuncion firmado es inmutable (Art. 40 NTEC)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bloquea_certdef ON ece.certificado_defuncion;
CREATE TRIGGER trg_bloquea_certdef
  BEFORE UPDATE OR DELETE ON ece.certificado_defuncion
  FOR EACH ROW EXECUTE FUNCTION ece.fn_bloquea_mutacion_certdef();
