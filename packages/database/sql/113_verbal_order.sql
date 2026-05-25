-- =============================================================================
-- 113_verbal_order.sql
-- JCI Standard: IPSG.2 ME 1 — Comunicación efectiva: read-back de órdenes verbales.
-- US.JCI.5.5 — Workflow read-back de órdenes verbales/telefónicas.
--
-- Ciclo obligatorio JCI:
--   1. Médico dicta la orden (estado: dictada)
--   2. Enfermera registra (estado: registrada)
--   3. Enfermera lee de vuelta lo escrito al médico
--   4. Médico confirma con PIN (estado: confirmada) o corrige (estado: rechazada)
--   5. Si rechazada: enfermera re-registra (nuevo registro, el anterior queda rechazado)
--
-- Tabla: ece.verbal_order
-- Idempotente: usa IF NOT EXISTS + DO/EXCEPTION para constraints.
-- Aplicar vía mcp__supabase__apply_migration (nombre: verbal_order_workflow_2026_05_24).
-- =============================================================================

CREATE TABLE IF NOT EXISTS ece.verbal_order (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episodio_id          uuid NOT NULL
                         REFERENCES ece.episodio_atencion(id)
                         ON DELETE RESTRICT,
  paciente_id          uuid NOT NULL
                         REFERENCES ece.paciente(id)
                         ON DELETE RESTRICT,
  -- Médico que dicta la orden (FK a personal de salud)
  dictado_por_id       uuid NOT NULL
                         REFERENCES ece.personal_salud(id)
                         ON DELETE RESTRICT,
  -- Enfermera que registra la orden
  registrado_por_id    uuid NOT NULL
                         REFERENCES ece.personal_salud(id)
                         ON DELETE RESTRICT,
  orden_texto          text NOT NULL,
  texto_readback       text,
  estado               text NOT NULL DEFAULT 'dictada'
                         CHECK (estado IN ('dictada','registrada','confirmada','rechazada')),
  -- Link opcional a IND_MED si la orden verbal se materializa en una indicación médica
  indicacion_item_id   uuid,
  -- Timestamps del ciclo JCI
  dictado_en           timestamptz NOT NULL DEFAULT now(),
  registrado_en        timestamptz,
  confirmado_en        timestamptz,
  -- Audit estándar
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Índices de acceso frecuente
CREATE INDEX IF NOT EXISTS idx_verbal_order_episodio
  ON ece.verbal_order (episodio_id, estado, dictado_en DESC);

CREATE INDEX IF NOT EXISTS idx_verbal_order_paciente
  ON ece.verbal_order (paciente_id);

-- =============================================================================
-- RLS: organization_id resuelto via JOIN con establecimiento del episodio.
-- La tabla no tiene organization_id propio; se hereda del episodio_atencion.
-- =============================================================================

ALTER TABLE ece.verbal_order ENABLE ROW LEVEL SECURITY;

-- Personal ECE puede leer órdenes de su establecimiento (via episodio_atencion)
DO $$
BEGIN
  DROP POLICY IF EXISTS verbal_order_select_policy ON ece.verbal_order;
  CREATE POLICY verbal_order_select_policy
    ON ece.verbal_order
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM ece.episodio_atencion ea
        WHERE ea.id = ece.verbal_order.episodio_id
          AND ea.establecimiento_id::text = current_setting('app.establecimiento_id', true)
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'verbal_order_select_policy: %', SQLERRM;
END $$;

-- Solo enfermera (registrado_por) puede insertar — SECURITY DEFINER validado en router
DO $$
BEGIN
  DROP POLICY IF EXISTS verbal_order_insert_policy ON ece.verbal_order;
  CREATE POLICY verbal_order_insert_policy
    ON ece.verbal_order
    FOR INSERT
    TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM ece.episodio_atencion ea
        WHERE ea.id = ece.verbal_order.episodio_id
          AND ea.establecimiento_id::text = current_setting('app.establecimiento_id', true)
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'verbal_order_insert_policy: %', SQLERRM;
END $$;

-- Solo el médico dictador puede confirmar/rechazar (UPDATE)
DO $$
BEGIN
  DROP POLICY IF EXISTS verbal_order_update_policy ON ece.verbal_order;
  CREATE POLICY verbal_order_update_policy
    ON ece.verbal_order
    FOR UPDATE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM ece.episodio_atencion ea
        WHERE ea.id = ece.verbal_order.episodio_id
          AND ea.establecimiento_id::text = current_setting('app.establecimiento_id', true)
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'verbal_order_update_policy: %', SQLERRM;
END $$;

-- =============================================================================
-- Audit hash chain — trigger updated_at
-- =============================================================================

CREATE OR REPLACE FUNCTION ece.fn_verbal_order_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_verbal_order_updated_at ON ece.verbal_order;
CREATE TRIGGER trg_verbal_order_updated_at
  BEFORE UPDATE ON ece.verbal_order
  FOR EACH ROW EXECUTE FUNCTION ece.fn_verbal_order_updated_at();

-- =============================================================================
-- Comentarios de documentación
-- =============================================================================

COMMENT ON TABLE ece.verbal_order IS
  'JCI IPSG.2 ME 1 — Registro del ciclo read-back de órdenes verbales/telefónicas. US.JCI.5.5.';

COMMENT ON COLUMN ece.verbal_order.estado IS
  'Ciclo JCI: dictada → registrada → (confirmada | rechazada). Si rechazada, el médico debe dictar nueva orden.';

COMMENT ON COLUMN ece.verbal_order.texto_readback IS
  'Texto leído de vuelta por la enfermera al médico antes de la confirmación.';

COMMENT ON COLUMN ece.verbal_order.indicacion_item_id IS
  'FK nullable a ece.indicaciones_medicas.id — enlaza la orden verbal con la IND_MED resultante.';
