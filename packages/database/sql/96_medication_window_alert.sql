-- F2-S14 Stream D — Alerta ventana terapéutica próxima a cerrar (US.F2.6.52)
--
-- Tabla: ece.medication_window_alert
-- Registra alertas enviadas cuando una indicación está < 15 min de cerrar su ventana terapéutica.
-- Append-only: nunca DELETE, UPDATE solo en atendidoEn / atendidoPorId.
-- RLS: enfermera ve solo sus alertas de la org.

CREATE TABLE IF NOT EXISTS ece.medication_window_alert (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  indication_id     TEXT        NOT NULL,
  organization_id   UUID        NOT NULL,
  ventana_cierre_en TIMESTAMPTZ NOT NULL,
  enviado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atendido_en       TIMESTAMPTZ,
  atendido_por_id   UUID,

  CONSTRAINT fk_mwa_org
    FOREIGN KEY (organization_id) REFERENCES public."Organization"(id) ON DELETE RESTRICT
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_mwa_org_pending
  ON ece.medication_window_alert (organization_id, enviado_en)
  WHERE atendido_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_mwa_indication
  ON ece.medication_window_alert (indication_id);

-- RLS
ALTER TABLE ece.medication_window_alert ENABLE ROW LEVEL SECURITY;

-- Lectura: solo dentro de la misma organización
CREATE POLICY mwa_select ON ece.medication_window_alert
  FOR SELECT
  USING (organization_id = (current_setting('app.current_org_id', true)::uuid));

-- Inserción: sistema (service_role via outbox) puede insertar
CREATE POLICY mwa_insert ON ece.medication_window_alert
  FOR INSERT
  WITH CHECK (organization_id = (current_setting('app.current_org_id', true)::uuid));

-- Update: solo atendidoEn / atendidoPorId (mark-as-attended)
CREATE POLICY mwa_update ON ece.medication_window_alert
  FOR UPDATE
  USING (
    organization_id = (current_setting('app.current_org_id', true)::uuid)
    AND atendido_en IS NULL
  );

-- Comentarios
COMMENT ON TABLE ece.medication_window_alert IS
  'US.F2.6.52 — Alertas de ventana terapéutica próxima a cerrar (< 15 min). Append-only.';
COMMENT ON COLUMN ece.medication_window_alert.ventana_cierre_en IS
  'Timestamp en que cierra la ventana terapéutica (lastAdmin + intervalo + tolerancia).';
COMMENT ON COLUMN ece.medication_window_alert.enviado_en IS
  'Cuándo se generó y envió la alerta (outbox event medication.window-closing).';
COMMENT ON COLUMN ece.medication_window_alert.atendido_en IS
  'NULL = alerta pendiente. Seteado cuando la enfermera confirma haber visto la alerta.';
