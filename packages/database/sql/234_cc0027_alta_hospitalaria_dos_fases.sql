-- =============================================================================
-- 234_cc0027_alta_hospitalaria_dos_fases.sql
-- CC-0027 — Alta hospitalaria en dos fases (Edwin, 2026-09-12).
--
-- Fase 1 (alta médica) ya existía: encounter-discharge.router.ts
-- dischargeEncounter (epicrisis + dischargedAt). Este archivo cierra la
-- Fase 2 (alta administrativa): conciliación financiera concluida por UNA de
-- dos rutas — (A) cancelación total de cargos (saldo pagado 100% o cobertura/
-- finiquito aprobado 100%) o (B) Cuenta por Cobrar (paciente o fiador
-- solidario firma pagaré/convenio/reconocimiento de deuda). El egreso físico
-- (liberación de cama) queda gateado a que la Fase 2 haya concluido — ver
-- packages/trpc/src/lib/egreso-fisico-gate.ts.
--
-- Contenido:
--   a) Enums nuevos (espejo schema.prisma): AltaRuta, DocumentoDeudaTipo,
--      FirmanteTipo, CxcEstado, CartaCoberturaTipo.
--   b) Tablas AccountReceivable (CxC) y CoverageLetter (carta cobertura/
--      finiquito) — RLS tenant estándar (mismo patrón sql/178) + trigger de
--      auditoría hash-chain reutilizando audit.fn_audit_row() (patrón sql/224).
--   c) Columnas nuevas: PatientAccount.altaAdministrativaAt/By/altaRuta,
--      Encounter.egresoAutorizadoAt/By.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DO $$
-- guards). Aplicar vía MCP Supabase (proyecto ejacvsgbewcerxtjtwto) o SQL
-- Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) Enums
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'AltaRuta' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public."AltaRuta" AS ENUM ('CANCELACION_TOTAL', 'CXC');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'DocumentoDeudaTipo' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public."DocumentoDeudaTipo" AS ENUM ('PAGARE', 'CONVENIO_PAGO', 'RECONOCIMIENTO_DEUDA');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'FirmanteTipo' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public."FirmanteTipo" AS ENUM ('PACIENTE', 'FIADOR');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'CxcEstado' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public."CxcEstado" AS ENUM ('ABIERTA', 'PAGADA', 'INCOBRABLE');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'CartaCoberturaTipo' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public."CartaCoberturaTipo" AS ENUM ('CARTA_COBERTURA', 'FINIQUITO');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- b.1) Tabla AccountReceivable (CxC — ruta B)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."AccountReceivable" (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"   uuid        NOT NULL REFERENCES public."Organization"(id)    ON DELETE RESTRICT,
  "accountId"        uuid        NOT NULL REFERENCES public."PatientAccount"(id)  ON DELETE RESTRICT,
  "saldoInicial"     numeric(14,2) NOT NULL,
  "saldoActual"      numeric(14,2) NOT NULL,
  "documentoTipo"    public."DocumentoDeudaTipo" NOT NULL,
  "folioDocumento"   varchar(80) NOT NULL,
  "firmanteTipo"     public."FirmanteTipo" NOT NULL,
  "firmanteNombre"   varchar(200) NOT NULL,
  "firmanteDocumento" varchar(40) NOT NULL,
  "plazoDias"        int,
  estado             public."CxcEstado" NOT NULL DEFAULT 'ABIERTA',
  notas              text,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "createdBy"        uuid,
  "updatedAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedBy"        uuid
);

CREATE INDEX IF NOT EXISTS idx_account_receivable_org ON public."AccountReceivable" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_account_receivable_account ON public."AccountReceivable" ("accountId");
CREATE INDEX IF NOT EXISTS idx_account_receivable_org_estado ON public."AccountReceivable" ("organizationId", estado);

-- -----------------------------------------------------------------------------
-- b.2) Tabla CoverageLetter (carta de cobertura / finiquito — ruta A)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."CoverageLetter" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid        NOT NULL REFERENCES public."Organization"(id)   ON DELETE RESTRICT,
  "accountId"      uuid        NOT NULL REFERENCES public."PatientAccount"(id) ON DELETE RESTRICT,
  "insurerId"      uuid        REFERENCES public."Insurer"(id)                 ON DELETE SET NULL,
  tipo             public."CartaCoberturaTipo" NOT NULL,
  "montoAprobado"  numeric(14,2) NOT NULL,
  folio            varchar(80) NOT NULL,
  "emitidaAt"      timestamptz NOT NULL DEFAULT now(),
  notas            text,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "createdBy"      uuid
);

CREATE INDEX IF NOT EXISTS idx_coverage_letter_org ON public."CoverageLetter" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_coverage_letter_account ON public."CoverageLetter" ("accountId");

-- -----------------------------------------------------------------------------
-- b.3) RLS — mismo patrón que sql/178 (tenant directo por organizationId)
-- -----------------------------------------------------------------------------

ALTER TABLE public."AccountReceivable" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_receivable_tenant ON public."AccountReceivable";
CREATE POLICY account_receivable_tenant ON public."AccountReceivable"
  FOR ALL TO authenticated
  USING ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE public."CoverageLetter" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coverage_letter_tenant ON public."CoverageLetter";
CREATE POLICY coverage_letter_tenant ON public."CoverageLetter"
  FOR ALL TO authenticated
  USING ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."AccountReceivable", public."CoverageLetter"
  TO authenticated;

-- -----------------------------------------------------------------------------
-- b.4) Auditoría — hash-chain, mismo patrón que sql/224 (reutiliza
--      audit.fn_audit_row(), SECURITY DEFINER; NO se crea función nueva).
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  financieras text[] := ARRAY['AccountReceivable', 'CoverageLetter'];
BEGIN
  FOREACH t IN ARRAY financieras LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_' || t, t);
    EXECUTE format(
      'CREATE TRIGGER %I
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row()',
      'trg_audit_' || t, t
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- c) Columnas nuevas — PatientAccount (alta administrativa) y Encounter
--    (autorización de egreso físico).
-- -----------------------------------------------------------------------------

ALTER TABLE public."PatientAccount"
  ADD COLUMN IF NOT EXISTS "altaAdministrativaAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "altaAdministrativaBy" uuid,
  ADD COLUMN IF NOT EXISTS "altaRuta"             public."AltaRuta";

COMMENT ON COLUMN public."PatientAccount"."altaRuta" IS
  'CC-0027 — CANCELACION_TOTAL (saldo pagado 100%/cobertura aprobada 100%) o CXC (documento de deuda firmado). NULL hasta que se concluye la Fase 2.';

ALTER TABLE public."Encounter"
  ADD COLUMN IF NOT EXISTS "egresoAutorizadoAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "egresoAutorizadoBy" uuid;

COMMENT ON COLUMN public."Encounter"."egresoAutorizadoAt" IS
  'CC-0027 — gate de egreso físico: la seteamos al concluir la Fase 2 (alta administrativa) de la PatientAccount asociada. Excepciones que NO pasan por esta columna: defunción, traslado interno de cama (ver packages/trpc/src/lib/egreso-fisico-gate.ts).';

-- =============================================================================
-- Verificación manual post-apply:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = ANY (ARRAY['"AccountReceivable"','"CoverageLetter"']::regclass[])
--      AND tgname LIKE 'trg_audit_%';                                  -- esperado: 2 filas
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'PatientAccount' AND column_name = 'altaRuta'; -- esperado: 1
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'Encounter' AND column_name = 'egresoAutorizadoAt'; -- esperado: 1
-- =============================================================================
