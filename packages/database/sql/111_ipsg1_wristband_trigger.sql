-- =============================================================================
-- 111_ipsg1_wristband_trigger.sql
-- JCI Standard: IPSG.1 ME 1 — Identificación correcta del paciente
-- US.JCI.5.4 — Wristband GSRN obligatorio antes de primera IND_MED
--
-- PRECONDICIÓN: el paciente del episodio DEBE tener GSRN asignado en
-- public."Patient".gsrn antes de poder registrar una indicación médica.
--
-- Cadena: ece.indicaciones_medicas.episodio_id
--       → ece.episodio_atencion.paciente_id
--       → ece.paciente.public_patient_id
--       → public."Patient".gsrn (NOT NULL / NOT EMPTY)
--
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- =============================================================================

CREATE OR REPLACE FUNCTION ece.fn_assert_wristband_gsrn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_gsrn text;
BEGIN
  SELECT p."gsrn"
    INTO v_gsrn
    FROM ece.episodio_atencion ea
    JOIN ece.paciente           cp ON cp.id = ea.paciente_id
    JOIN public."Patient"       p  ON p.id  = cp.public_patient_id
   WHERE ea.id = NEW.episodio_id;

  IF v_gsrn IS NULL OR trim(v_gsrn) = '' THEN
    RAISE EXCEPTION
      'PRECONDITION_FAILED: IPSG1_WRISTBAND_REQUIRED — Patient sin GSRN de pulsera asignado'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Reasignar propiedad al rol privilegiado del proyecto (no al rol de sesión)
ALTER FUNCTION ece.fn_assert_wristband_gsrn() OWNER TO postgres;

-- Trigger idempotente: drop previo garantiza una sola instancia
DROP TRIGGER IF EXISTS trg_ipsg1_wristband_gsrn
  ON ece.indicaciones_medicas;

CREATE TRIGGER trg_ipsg1_wristband_gsrn
  BEFORE INSERT
  ON ece.indicaciones_medicas
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_assert_wristband_gsrn();

COMMENT ON FUNCTION ece.fn_assert_wristband_gsrn() IS
  'JCI IPSG.1 ME 1 — Rechaza IND_MED si el paciente del episodio no tiene GSRN de pulsera. SQLSTATE 23514.';

COMMENT ON TRIGGER trg_ipsg1_wristband_gsrn ON ece.indicaciones_medicas IS
  'US.JCI.5.4 — Wristband GSRN obligatorio. Fuente: public."Patient".gsrn via ece.paciente.';
