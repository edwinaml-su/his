-- =============================================================================
-- 94_farmacovigilancia_epcis.sql
-- GS1 EPCIS Event table + Farmacovigilancia Incidents (US.F2.6.53-58)
--
-- Nota: ece.epcis_event ya existe como tabla legacy (equipment tracker).
-- Este script usa ece.gs1_epcis_event para los eventos GS1 EPCIS 1.2/2.0.
--
-- Nuevas tablas en schema ece:
--   ece.gs1_epcis_event           — eventos EPCIS completos (WHAT/WHERE/WHEN/WHY/WHO)
--   ece.farmacovigilancia_incident — incidentes de farmacovigilancia generados
--                                    desde el outbox (alergias, recalls, duplicados, vencidos)
--
-- RLS:
--   gs1_epcis_event: SELECT/INSERT authenticated con establecimiento_id;
--                    no UPDATE/DELETE (inmutable — trigger bloquea).
--   farmacovigilancia_incident: tenant-scoped (establecimiento_id).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + CREATE POLICY.
-- Aplicado vía mcp__supabase__apply_migration (migration 94d_gs1_epcis_event_farmacovigilancia).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. gs1_epcis_event — registro inmutable de eventos GS1 EPCIS 1.2 / 2.0
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.gs1_epcis_event (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tipo de evento EPCIS según GS1 EPCIS 1.2
  tipo_evento        text        NOT NULL
                       CHECK (tipo_evento IN (
                         'ObjectEvent', 'AggregationEvent', 'TransactionEvent',
                         'TransformationEvent', 'AssociationEvent'
                       )),
  -- Subtipo operacional interno (trazabilidad)
  subtipo            text        NOT NULL
                       CHECK (subtipo IN (
                         'BEDSIDE_ADMIN', 'PHARMACY_DISPENSE',
                         'RESERVATION', 'SUBSTITUTION', 'RETURN'
                       )),
  -- WHAT: EPC list + atributos del ítem (GTIN, lote, serial, vencimiento)
  what               jsonb       NOT NULL,
  -- WHERE: readPoint GLN + bizLocation GLN
  where_data         jsonb       NOT NULL,
  -- WHEN: eventTime (timestamp del acto clínico) + recordTime (timestamp de persistencia)
  event_time         timestamptz NOT NULL,
  record_time        timestamptz NOT NULL DEFAULT now(),
  -- WHY: businessStep + disposition + bizTransactionList
  why                jsonb       NOT NULL,
  -- WHO: GSRN profesional + GSRN paciente + sourceList / destinationList
  who                jsonb       NOT NULL,
  -- Hash SHA-256 del payload completo (inmutabilidad)
  payload_hash       char(64)    NOT NULL,
  -- FK a la indicación/orden que originó el evento (trazabilidad receta→admin)
  indication_id      uuid,
  -- FK al establecimiento (tenant)
  establecimiento_id uuid        NOT NULL REFERENCES ece.establecimiento(id) ON DELETE RESTRICT,
  -- Estado del evento
  status             text        NOT NULL DEFAULT 'COMMITTED'
                       CHECK (status IN ('COMMITTED', 'VOIDED')),
  -- Timestamps
  creado_en          timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_event_what
  ON ece.gs1_epcis_event USING GIN (what);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_event_establecimiento
  ON ece.gs1_epcis_event (establecimiento_id);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_event_event_time
  ON ece.gs1_epcis_event (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_event_subtipo
  ON ece.gs1_epcis_event (subtipo);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_event_payload_hash
  ON ece.gs1_epcis_event (payload_hash);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_event_indication
  ON ece.gs1_epcis_event (indication_id)
  WHERE indication_id IS NOT NULL;

COMMENT ON TABLE ece.gs1_epcis_event IS
  'Registro inmutable de eventos EPCIS GS1 1.2 / 2.0. '
  'Cubre los procesos D (dispensación) y E (bedside) de la guía GS1 Healthcare. '
  'Columna what=WHAT, where_data=WHERE, event_time=WHEN, why=WHY, who=WHO. '
  'Inmutable: un trigger bloquea UPDATE/DELETE sobre filas COMMITTED.';

-- Trigger de inmutabilidad (bloquea UPDATE/DELETE sobre filas COMMITTED)
CREATE OR REPLACE FUNCTION ece.fn_gs1_epcis_event_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.status = 'COMMITTED' THEN
    RAISE EXCEPTION 'gs1_epcis_event COMMITTED es inmutable. Rechazado: %, id=%',
      TG_OP, OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_gs1_epcis_event_immutable ON ece.gs1_epcis_event;
CREATE TRIGGER trg_gs1_epcis_event_immutable
  BEFORE UPDATE OR DELETE ON ece.gs1_epcis_event
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_gs1_epcis_event_immutable();

-- ---------------------------------------------------------------------------
-- 2. FarmacovigilanciaIncident — incidentes generados por el outbox
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.farmacovigilancia_incident (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tipo de incidente detectado
  tipo                  text        NOT NULL
                          CHECK (tipo IN (
                            'ALERGIA_DETECTADA', 'RECALL_DETECTADO',
                            'DOBLE_DISPENSACION', 'DOSIS_VENCIDA',
                            'HARD_STOP_PATRON', 'OTRO'
                          )),
  -- Severidad clínica
  severity              text        NOT NULL
                          CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  -- FKs opcionales según el tipo de incidente
  patient_id            uuid,
  gtin                  char(14),
  gsrn_enfermera        char(18),
  -- Payload completo del evento que originó el incidente (jsonb)
  payload               jsonb       NOT NULL DEFAULT '{}',
  -- Timestamps del ciclo de vida del incidente
  detected_at           timestamptz NOT NULL DEFAULT now(),
  acknowledged_at       timestamptz,
  acknowledged_by_id    uuid,
  escalated_at          timestamptz,
  escalation_motivo     text,
  -- Estado del incidente
  status                text        NOT NULL DEFAULT 'PENDIENTE'
                          CHECK (status IN (
                            'PENDIENTE', 'RECONOCIDO', 'ESCALADO', 'CERRADO'
                          )),
  -- Tenant
  establecimiento_id    uuid        NOT NULL REFERENCES ece.establecimiento(id) ON DELETE RESTRICT,
  -- Referencia al DomainEvent del outbox que originó el incidente
  domain_event_id       uuid,
  -- Timestamp
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_farmacovig_establecimiento
  ON ece.farmacovigilancia_incident (establecimiento_id);
CREATE INDEX IF NOT EXISTS idx_farmacovig_status
  ON ece.farmacovigilancia_incident (status);
CREATE INDEX IF NOT EXISTS idx_farmacovig_severity
  ON ece.farmacovigilancia_incident (severity);
CREATE INDEX IF NOT EXISTS idx_farmacovig_detected
  ON ece.farmacovigilancia_incident (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_farmacovig_patient
  ON ece.farmacovigilancia_incident (patient_id)
  WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_farmacovig_gtin
  ON ece.farmacovigilancia_incident (gtin)
  WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_farmacovig_payload
  ON ece.farmacovigilancia_incident USING GIN (payload);

COMMENT ON TABLE ece.farmacovigilancia_incident IS
  'Incidentes de farmacovigilancia generados automáticamente por el outbox Beta.15. '
  'Fuentes: alergias detectadas bedside, recalls de lote, doble dispensación, '
  'dosis vencida intentada. Ciclo de vida: PENDIENTE→RECONOCIDO→ESCALADO→CERRADO.';

-- Trigger actualizado_en
CREATE OR REPLACE FUNCTION ece.fn_farmacovig_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_farmacovig_updated_at ON ece.farmacovigilancia_incident;
CREATE TRIGGER trg_farmacovig_updated_at
  BEFORE UPDATE ON ece.farmacovigilancia_incident
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_farmacovig_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS — gs1_epcis_event (Cat-B: tenant-scoped por establecimiento_id)
-- ---------------------------------------------------------------------------

ALTER TABLE ece.gs1_epcis_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gs1_epcis_event_select ON ece.gs1_epcis_event;
CREATE POLICY gs1_epcis_event_select ON ece.gs1_epcis_event
  FOR SELECT
  TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id_safe());

DROP POLICY IF EXISTS gs1_epcis_event_insert ON ece.gs1_epcis_event;
CREATE POLICY gs1_epcis_event_insert ON ece.gs1_epcis_event
  FOR INSERT
  TO authenticated
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id_safe());

-- UPDATE/DELETE bloqueados por trigger; no se declara policy de escritura.

-- ---------------------------------------------------------------------------
-- 4. RLS — farmacovigilancia_incident (Cat-B: tenant-scoped)
-- ---------------------------------------------------------------------------

ALTER TABLE ece.farmacovigilancia_incident ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farmacovig_select ON ece.farmacovigilancia_incident;
CREATE POLICY farmacovig_select ON ece.farmacovigilancia_incident
  FOR SELECT
  TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id_safe());

DROP POLICY IF EXISTS farmacovig_insert ON ece.farmacovigilancia_incident;
CREATE POLICY farmacovig_insert ON ece.farmacovigilancia_incident
  FOR INSERT
  TO authenticated
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id_safe());

DROP POLICY IF EXISTS farmacovig_update ON ece.farmacovigilancia_incident;
CREATE POLICY farmacovig_update ON ece.farmacovigilancia_incident
  FOR UPDATE
  TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id_safe())
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id_safe());

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON ece.gs1_epcis_event TO authenticated;
GRANT SELECT, INSERT, UPDATE ON ece.farmacovigilancia_incident TO authenticated;
GRANT ALL ON ece.gs1_epcis_event TO service_role;
GRANT ALL ON ece.farmacovigilancia_incident TO service_role;
