-- =====================================================================
-- 199_epcis_patient_movement.sql
-- EPCIS de movimiento de paciente — admisión, traslado, alta.
--
-- Tabla SEPARADA de ece.gs1_epcis_event (farmacia) por mandato del
-- dictamen @AE (docs/audit/2026-08-18_dictamen_ae_epcis_trazabilidad_paciente.md,
-- §3.5, restricción 2): el stream de ubicación de un paciente identificable
-- no puede heredar el trigger de inmutabilidad hash-chain de ADR 0017 — debe ser
-- purgable/anonimizable ante una solicitud ARCO de supresión (SolicitudArco,
-- portal-arco.router.ts). Los registros fuente (Encounter, EncounterTransfer,
-- BedAssignment) NO se tocan — siguen protegidos por retención NTEC Art. 6.
-- Esta tabla es una PROYECCIÓN DERIVADA de esos registros, no la fuente legal.
--
-- ADVERTENCIA PARA QUIEN TOQUE ESTE ARCHIVO DESPUÉS: NO agregar un trigger
-- BEFORE UPDATE OR DELETE tipo ece.fn_gs1_epcis_event_immutable (SQL 94) a
-- esta tabla. Es una decisión deliberada, no un olvido — ver ADR 0019 D5 y
-- dictamen @AE §3.5 punto 3 (condición de diseño no negociable).
--
-- Ver ADR 0019 (docs/adr/0019-gs1-trazabilidad-paciente-epcis.md, revisión
-- post-dictamen) para el razonamiento completo.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. gs1_epcis_patient_event
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.gs1_epcis_patient_event (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Todos los subtipos de este stream son ObjectEvent (ver ADR 0019 D3/D4) —
  -- el CHECK no necesita la lista de 5 tipos EPCIS completa que sí requiere
  -- farmacia (ece.gs1_epcis_event).
  tipo_evento        text        NOT NULL DEFAULT 'ObjectEvent'
                       CHECK (tipo_evento = 'ObjectEvent'),
  subtipo            text        NOT NULL
                       CHECK (subtipo IN (
                         'PATIENT_ADMISSION', 'PATIENT_TRANSFER_DEPARTURE',
                         'PATIENT_TRANSFER_ARRIVAL', 'PATIENT_DISCHARGE'
                       )),
  -- WHAT: EPC del paciente (GSRN). Ver ADR 0019 D5 "forma exacta de los jsonb".
  what               jsonb       NOT NULL,
  -- WHERE: readPoint/bizLocation GLN (nullable, ver ADR 0019 D8) + internalRef.
  where_data         jsonb       NOT NULL,
  event_time         timestamptz NOT NULL,
  record_time        timestamptz NOT NULL DEFAULT now(),
  -- WHY: businessStep + disposition + referencias a Encounter/EncounterTransfer (solo IDs).
  why                jsonb       NOT NULL,
  -- WHO: identificadores opacos únicamente (GSRN paciente, userId que registró). Cero PHI.
  who                jsonb       NOT NULL,
  -- Hash de integridad de una fila — NO cadena (sin prev_hash/chain_hash).
  -- Detecta corrupción de una fila individual; no crea ningún compromiso de
  -- inmutabilidad y no impide UPDATE/purga. Ver ADR 0019 D5.
  payload_hash       char(64)    NOT NULL,
  establecimiento_id uuid        NOT NULL REFERENCES ece.establecimiento(id) ON DELETE RESTRICT,
  -- COMMITTED (normal) | VOIDED (corrección operativa) | SUPPRESSED (ARCO aprobada — anonimizado).
  status             text        NOT NULL DEFAULT 'COMMITTED'
                       CHECK (status IN ('COMMITTED', 'VOIDED', 'SUPPRESSED')),
  -- Trazabilidad de la propia supresión (cuándo/por qué solicitud ARCO, si aplica).
  suppressed_at      timestamptz,
  suppressed_by_arco_request_id uuid,
  creado_en          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gs1_epcis_patient_event_what
  ON ece.gs1_epcis_patient_event USING GIN (what);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_patient_event_establecimiento
  ON ece.gs1_epcis_patient_event (establecimiento_id);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_patient_event_event_time
  ON ece.gs1_epcis_patient_event (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_patient_event_subtipo
  ON ece.gs1_epcis_patient_event (subtipo);
-- Índice funcional para el patrón de consulta "cadena de custodia de un paciente" por GSRN.
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_patient_event_epc
  ON ece.gs1_epcis_patient_event ((what->'epcList'));

COMMENT ON TABLE ece.gs1_epcis_patient_event IS
  'Proyección derivada, purgable/anonimizable, de eventos ObjectEvent de movimiento de paciente '
  '(admisión/traslado/alta). NO es fuente de verdad legal (esa es Encounter/EncounterTransfer/'
  'BedAssignment) y NO tiene trigger de inmutabilidad — a diferencia de ece.gs1_epcis_event '
  '(farmacia). Ver ADR 0019 y dictamen @AE 2026-08-18.';

-- ---------------------------------------------------------------------------
-- 2. RLS — mismo patrón tenant-scoped que ece.gs1_epcis_event (SQL 94), pero
-- SIN grant de UPDATE/DELETE a `authenticated`: la única vía de mutación de
-- una fila ya insertada es la función SECURITY DEFINER de anonimización de
-- abajo, invocada desde un flujo administrativo controlado
-- (portal-arco.router.ts al resolver una SUPRESION APROBADA), nunca desde
-- un router de escritura de uso general. Esto evita crear un segundo camino
-- de escritura paralelo al ya aceptado para ARCO (dictamen §3.5 punto 3).
-- ---------------------------------------------------------------------------

ALTER TABLE ece.gs1_epcis_patient_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gs1_epcis_patient_event_select ON ece.gs1_epcis_patient_event;
CREATE POLICY gs1_epcis_patient_event_select ON ece.gs1_epcis_patient_event
  FOR SELECT
  TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id_safe());

DROP POLICY IF EXISTS gs1_epcis_patient_event_insert ON ece.gs1_epcis_patient_event;
CREATE POLICY gs1_epcis_patient_event_insert ON ece.gs1_epcis_patient_event
  FOR INSERT
  TO authenticated
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id_safe());

-- Sin policy de UPDATE/DELETE para `authenticated` — ver comentario arriba.
GRANT SELECT, INSERT ON ece.gs1_epcis_patient_event TO authenticated;
GRANT ALL ON ece.gs1_epcis_patient_event TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Anonimización ARCO — única vía de mutación post-insert. SECURITY DEFINER
-- con search_path fijo (patrón obligatorio del proyecto, CLAUDE.md §Patrones
-- de seguridad establecidos). Sustituye el GSRN por un token no reversible
-- dentro de what/who y marca status=SUPPRESSED. No borra la fila (se
-- conserva el conteo/estructura del evento para auditoría de que "algo
-- ocurrió aquí", solo se despersonaliza) — ruta equivalente al "bloqueo"
-- que los marcos tipo RGPD usan para datos con retención legal del registro
-- fuente pero sin obligación de retener la proyección derivada.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.fn_gs1_epcis_patient_event_anonymize(
  p_gsrn_paciente text,
  p_arco_request_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ece, public, pg_catalog
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE ece.gs1_epcis_patient_event
     SET what = jsonb_set(jsonb_set(what, '{gsrn}', 'null'::jsonb), '{epcList}', '[]'::jsonb),
         who  = jsonb_set(who, '{sourceList}', '[]'::jsonb),
         status = 'SUPPRESSED',
         suppressed_at = now(),
         suppressed_by_arco_request_id = p_arco_request_id
   WHERE what->>'gsrn' = p_gsrn_paciente
     AND status <> 'SUPPRESSED';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION ece.fn_gs1_epcis_patient_event_anonymize(text, uuid) OWNER TO postgres;

COMMENT ON FUNCTION ece.fn_gs1_epcis_patient_event_anonymize IS
  'Ejecuta la porción "capa EPCIS derivada" de una SUPRESION ARCO aprobada '
  '(SolicitudArco, portal-arco.router.ts). Anonimiza, no borra. No toca '
  'Encounter/EncounterTransfer/BedAssignment (retención NTEC Art. 6 intacta). '
  'Ver dictamen @AE 2026-08-18 §3.5 punto 5 y ADR 0019.';

-- ---------------------------------------------------------------------------
-- 4. GLN de servicio/cama (ADR 0019 D8) — columnas nullable, FK a
-- ece.gs1_gln(codigo), replicando el patrón de BiomedicalEquipment.gln_ubicacion_actual
-- (SQL 82_equipment_gs1_extension.sql).
-- ---------------------------------------------------------------------------

-- NOTA: ADR 0019 D8 especifica el tipo Prisma como `@db.VarChar(13)` pero su
-- propio snippet SQL usaba `text` sin longitud — inconsistencia interna del
-- ADR (documentada en el reporte de esta migración). Se resuelve aquí a favor
-- de varchar(13): coincide con schema.prisma, con ece.gs1_gln.codigo char(13)
-- (GLN-13 es siempre longitud fija) y evita drift Prisma↔SQL nuevo.
ALTER TABLE public."ServiceUnit"
  ADD COLUMN IF NOT EXISTS "glnCodigo" varchar(13)
    CONSTRAINT fk_serviceunit_gln REFERENCES ece.gs1_gln(codigo) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public."Bed"
  ADD COLUMN IF NOT EXISTS "glnCodigo" varchar(13)
    CONSTRAINT fk_bed_gln REFERENCES ece.gs1_gln(codigo) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_serviceunit_gln ON public."ServiceUnit" ("glnCodigo") WHERE "glnCodigo" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bed_gln ON public."Bed" ("glnCodigo") WHERE "glnCodigo" IS NOT NULL;

COMMENT ON COLUMN public."ServiceUnit"."glnCodigo" IS
  'GLN (GS1 Global Location Number) de la unidad de servicio, para resolución WHERE de eventos '
  'EPCIS de movimiento de paciente (ece.gs1_epcis_patient_event). Nullable mientras el catálogo '
  'ece.gs1_gln no esté sembrado — ver ADR 0019 D8.';
COMMENT ON COLUMN public."Bed"."glnCodigo" IS
  'GLN (GS1 Global Location Number) de la cama, para resolución WHERE de eventos EPCIS de '
  'movimiento de paciente (ece.gs1_epcis_patient_event). Nullable mientras el catálogo '
  'ece.gs1_gln no esté sembrado — ver ADR 0019 D8.';
