-- =============================================================================
-- 266_cc0044_formularios_fuera_de_red.sql
-- CC-0044 — Formularios de médico fuera de red (módulo de aseguradoras).
--
-- Digitaliza 2 formularios físicos de AVANTE dentro del dominio existente de
-- seguros (Insurer/InsurancePlan/PatientCoverage — CC-0028, sql/235), según
-- el protocolo de recepción: cuando el médico tratante NO pertenece a la red
-- de la aseguradora del paciente, recepción documenta los intentos de
-- localizar un médico de la red (censo de llamadas) y hace firmar al
-- asegurado/responsable una constancia de respaldo ANTES de cerrar la
-- admisión.
--
-- Contenido:
--   a) NetworkCallCensus       — cabecera del "Censo de llamada seguro médico".
--   b) NetworkCallCensusEntry  — filas del censo (médico llamado / resultado).
--   c) OutOfNetworkAttestation — "Constancia de atención por médico fuera de
--                                 red" (respaldo AVANTE cuando no se usa el
--                                 formulario propio de la aseguradora).
--   d) RLS (tenant por organizationId, heredada en (b) vía censusId) + REVOKE
--      ALL de anon (lección pagada: default privileges dan DML a anon en
--      tablas nuevas — sql/152/261) + GRANT a authenticated.
--   e) Auditoría hash-chain (mismo patrón que sql/235/234, reutiliza
--      audit.fn_audit_row(); NO se crea función nueva).
--
-- v1 — NO incluye: enforcement de bloqueo de cierre de admisión (queda para
-- el flujo de admisión, fuera de este CC) ni notificación automática a
-- Cuentas/Seguros (DomainEvent) — ver docs/CC/CC-0044-formularios-fuera-de-red.md.
--
-- Idempotente (CREATE TABLE IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS).
-- Requiere sql/235 aplicado ("Insurer" debe existir). NO aplicado a prod — el
-- orquestador (@Orq) lo aplica vía MCP. NO re-numerar: es el 266.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) NetworkCallCensus — cabecera del censo de llamadas.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."NetworkCallCensus" (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"    uuid          NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "establishmentId"   uuid          REFERENCES public."Establishment"(id) ON DELETE SET NULL,
  "patientId"         uuid          NOT NULL REFERENCES public."Patient"(id) ON DELETE RESTRICT,
  "patientAccountId"  uuid          REFERENCES public."PatientAccount"(id) ON DELETE SET NULL,
  "insurerId"         uuid          REFERENCES public."Insurer"(id) ON DELETE SET NULL,
  -- Texto libre cuando la aseguradora no está en el catálogo (Insurer).
  "aseguradoraNombre" varchar(200),
  diagnostico         text          NOT NULL,
  status              varchar(20)   NOT NULL DEFAULT 'BORRADOR',
  "medicoTurnoUserId" uuid          REFERENCES public."User"(id) ON DELETE SET NULL,
  "firmadoAt"         timestamptz,
  notas               text,
  -- Motivo requerido al anular (espejo de AuthorizationRequest.denialReason).
  "motivoAnulacion"   varchar(400),
  "createdAt"         timestamptz   NOT NULL DEFAULT now(),
  "createdBy"         uuid,
  "updatedAt"         timestamptz   NOT NULL DEFAULT now(),
  "updatedBy"         uuid,

  CONSTRAINT network_call_census_status_check
    CHECK (status IN ('BORRADOR', 'FIRMADO', 'ANULADO')),
  CONSTRAINT network_call_census_insurer_check
    CHECK ("insurerId" IS NOT NULL OR "aseguradoraNombre" IS NOT NULL)
);

COMMENT ON TABLE public."NetworkCallCensus" IS
  'CC-0044 — "Censo de llamada seguro médico": documenta los médicos de la red de la aseguradora a los que recepción llamó antes de admitir con un médico fuera de red. Cabecera; ver "NetworkCallCensusEntry" para las filas.';
COMMENT ON COLUMN public."NetworkCallCensus"."medicoTurnoUserId" IS
  'Médico de turno que firma el pie del formulario. Se asigna en la acción sign() (rol médico), no en la creación del borrador.';

CREATE INDEX IF NOT EXISTS idx_network_call_census_org_patient
  ON public."NetworkCallCensus" ("organizationId", "patientId");
CREATE INDEX IF NOT EXISTS idx_network_call_census_insurer
  ON public."NetworkCallCensus" ("insurerId") WHERE "insurerId" IS NOT NULL;

ALTER TABLE public."NetworkCallCensus" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS network_call_census_tenant ON public."NetworkCallCensus";
CREATE POLICY network_call_census_tenant ON public."NetworkCallCensus"
  FOR ALL TO authenticated
  USING ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

REVOKE ALL ON public."NetworkCallCensus" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."NetworkCallCensus" TO authenticated;

-- -----------------------------------------------------------------------------
-- b) NetworkCallCensusEntry — filas del censo (un médico de la red llamado).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."NetworkCallCensusEntry" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "censusId"       uuid        NOT NULL REFERENCES public."NetworkCallCensus"(id) ON DELETE CASCADE,
  "ordenIndex"     int         NOT NULL DEFAULT 0,
  "doctorNombre"   varchar(200) NOT NULL,
  telefono         varchar(40),
  -- NULL = aún no se intentó / sin registrar; true/false = sí atendió / no atendió.
  "atendioLlamada" boolean,
  comentarios      varchar(300),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."NetworkCallCensusEntry" IS
  'CC-0044 — fila del censo de llamadas: un médico de la red al que se llamó, con resultado (SÍ/NO atendió) y comentario libre (ej. "No contestó").';

CREATE INDEX IF NOT EXISTS idx_network_call_census_entry_census
  ON public."NetworkCallCensusEntry" ("censusId");

ALTER TABLE public."NetworkCallCensusEntry" ENABLE ROW LEVEL SECURITY;

-- Tenancy heredada del censo (mismo patrón que insurance_plan_coverage_inherit_plan, sql/235).
DROP POLICY IF EXISTS network_call_census_entry_inherit ON public."NetworkCallCensusEntry";
CREATE POLICY network_call_census_entry_inherit ON public."NetworkCallCensusEntry"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."NetworkCallCensus" c
      WHERE c.id = "NetworkCallCensusEntry"."censusId"
        AND c."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public."NetworkCallCensus" c
      WHERE c.id = "NetworkCallCensusEntry"."censusId"
        AND c."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
    )
  );

REVOKE ALL ON public."NetworkCallCensusEntry" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."NetworkCallCensusEntry" TO authenticated;

-- -----------------------------------------------------------------------------
-- c) OutOfNetworkAttestation — "Constancia de atención por médico fuera de
--    red" (respaldo AVANTE, firmada por el asegurado/responsable).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."OutOfNetworkAttestation" (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"     uuid          NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "establishmentId"    uuid          REFERENCES public."Establishment"(id) ON DELETE SET NULL,
  "patientId"          uuid          NOT NULL REFERENCES public."Patient"(id) ON DELETE RESTRICT,
  "patientAccountId"   uuid          REFERENCES public."PatientAccount"(id) ON DELETE SET NULL,
  "insurerId"          uuid          REFERENCES public."Insurer"(id) ON DELETE SET NULL,
  "aseguradoraNombre"  varchar(200),
  "polizaNumero"       varchar(80),
  "certificadoCarnet"  varchar(80),
  "aseguradoTitular"   varchar(200)  NOT NULL,
  parentesco           varchar(20)   NOT NULL,
  "parentescoOtro"     varchar(120),
  "doctorNombre"       varchar(200)  NOT NULL,
  "doctorEspecialidad" varchar(200)  NOT NULL,
  "telefonoContacto"   varchar(40),
  "lugarFecha"         varchar(200),
  status               varchar(20)   NOT NULL DEFAULT 'PENDIENTE_FIRMA',
  "firmadoAt"          timestamptz,
  "motivoAnulacion"    varchar(400),
  "createdAt"          timestamptz   NOT NULL DEFAULT now(),
  "createdBy"          uuid,
  "updatedAt"          timestamptz   NOT NULL DEFAULT now(),
  "updatedBy"          uuid,

  CONSTRAINT out_of_network_attestation_status_check
    CHECK (status IN ('PENDIENTE_FIRMA', 'FIRMADO', 'ANULADO')),
  CONSTRAINT out_of_network_attestation_parentesco_check
    CHECK (parentesco IN ('TITULAR', 'CONYUGE', 'HIJO', 'OTRO')),
  CONSTRAINT out_of_network_attestation_parentesco_otro_check
    CHECK (parentesco <> 'OTRO' OR "parentescoOtro" IS NOT NULL),
  CONSTRAINT out_of_network_attestation_insurer_check
    CHECK ("insurerId" IS NOT NULL OR "aseguradoraNombre" IS NOT NULL)
);

COMMENT ON TABLE public."OutOfNetworkAttestation" IS
  'CC-0044 — "Constancia de atención por médico fuera de red" (respaldo AVANTE): el asegurado/responsable declara que fue informado de que el médico tratante no pertenece a la red de su aseguradora. markFirmado registra que el impreso físico fue firmado (no hay firma digital en v1 — ver docs/CC/CC-0044-formularios-fuera-de-red.md).';

CREATE INDEX IF NOT EXISTS idx_out_of_network_attestation_org_patient
  ON public."OutOfNetworkAttestation" ("organizationId", "patientId");
CREATE INDEX IF NOT EXISTS idx_out_of_network_attestation_insurer
  ON public."OutOfNetworkAttestation" ("insurerId") WHERE "insurerId" IS NOT NULL;

ALTER TABLE public."OutOfNetworkAttestation" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS out_of_network_attestation_tenant ON public."OutOfNetworkAttestation";
CREATE POLICY out_of_network_attestation_tenant ON public."OutOfNetworkAttestation"
  FOR ALL TO authenticated
  USING ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

REVOKE ALL ON public."OutOfNetworkAttestation" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."OutOfNetworkAttestation" TO authenticated;

-- -----------------------------------------------------------------------------
-- d) Auditoría — hash-chain (patrón sql/235, reutiliza audit.fn_audit_row()).
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY['NetworkCallCensus', 'NetworkCallCensusEntry', 'OutOfNetworkAttestation'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_' || t, t);
    EXECUTE format(
      'CREATE TRIGGER %I
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row()',
      'trg_audit_' || t, t
    );
  END LOOP;
END $$;

-- =============================================================================
-- Verificación manual post-apply:
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name IN ('NetworkCallCensus','NetworkCallCensusEntry','OutOfNetworkAttestation'); -- 3
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = ANY (ARRAY['"NetworkCallCensus"','"NetworkCallCensusEntry"','"OutOfNetworkAttestation"']::regclass[])
--      AND tgname LIKE 'trg_audit_%';                                           -- 3 filas
--   SELECT has_table_privilege('anon', '"NetworkCallCensus"', 'INSERT');        -- false
-- =============================================================================
