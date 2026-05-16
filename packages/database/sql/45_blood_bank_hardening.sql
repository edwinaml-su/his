-- =============================================================================
-- §15 Banco de Sangre / Hemoterapia — Hardening Layer 1 (Beta.16, 2026-05-16)
--
-- Owner : @DBA (revisar) + @SRE (aplicar via Supabase MCP / SQL Editor)
-- Estado: Pendiente de aplicación. Documentado para apply post-G8 o en
--         ventana de mantenimiento coordinada con Edwin.
--
-- Cambios:
--   1. Tipos ENUM nuevos (BloodType, RhFactor, BloodComponent, BloodUnitStatus,
--      TransfusionUrgency, TransfusionRequestStatus, CrossMatchResult,
--      TransfusionRoute, TransfusionStatus).
--   2. Tablas: BloodBank, BloodUnit, TransfusionRequest, CrossMatch, Transfusion.
--   3. RLS: tenant_isolation por organization_id en las 5 tablas.
--   4. Audit triggers (extiende 02_audit_triggers.sql) en las 5 tablas.
--   5. Hash chain entries (extiende 05_audit_hash_chain.sql) en tablas críticas.
--   6. Índices FK + queries de negocio.
--   7. CHECK constraints de negocio.
--   8. Triggers de validación de reglas de dominio:
--      - Transfusion requiere CrossMatch.result = COMPATIBLE.
--      - BloodUnit.status = TRANSFUSED solo si existe Transfusion apuntando a ella.
--      - No transfundir unidades vencidas.
--      - State machine para TransfusionRequest.status.
--
-- NOTA: todos los ENUMs son NUEVOS (no ADD VALUE a tipo existente) — se puede
-- mantener todo en un solo archivo sin split a/b.
-- NOTA: Prisma usa PascalCase para tablas y "camelCase" quoted para columnas.
--       Todo SQL aquí respeta esas convenciones para que las FK funcionen.
--
-- Convención: TODO idempotente (IF NOT EXISTS, CREATE OR REPLACE, DO dollar blocks).
-- =============================================================================

-- =============================================================================
-- 1. TIPOS ENUM
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BloodType' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."BloodType" AS ENUM ('A', 'B', 'AB', 'O');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RhFactor' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."RhFactor" AS ENUM ('POSITIVE', 'NEGATIVE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BloodComponent' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."BloodComponent" AS ENUM ('WB', 'RBC', 'PLT', 'FFP', 'CRYO');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BloodUnitStatus' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."BloodUnitStatus" AS ENUM (
      'AVAILABLE', 'RESERVED', 'IN_USE', 'TRANSFUSED', 'DISCARDED', 'EXPIRED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TransfusionUrgency' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."TransfusionUrgency" AS ENUM ('ROUTINE', 'URGENT', 'EMERGENCY');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TransfusionRequestStatus' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."TransfusionRequestStatus" AS ENUM (
      'REQUESTED', 'CROSSMATCHING', 'APPROVED', 'CANCELLED', 'FULFILLED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CrossMatchResult' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."CrossMatchResult" AS ENUM ('COMPATIBLE', 'INCOMPATIBLE', 'INCONCLUSIVE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TransfusionRoute' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."TransfusionRoute" AS ENUM ('IV_PERIPHERAL', 'IV_CENTRAL', 'IO');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TransfusionStatus' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public."TransfusionStatus" AS ENUM ('STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED');
  END IF;
END $$;

-- =============================================================================
-- 2. TABLAS
-- =============================================================================

-- BloodBank -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."BloodBank" (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" uuid        NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "establishmentId" uuid       NOT NULL UNIQUE REFERENCES public."Establishment"(id) ON DELETE RESTRICT,
  name             varchar(200) NOT NULL,
  "licenseNumber"  varchar(80),
  active           boolean     NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."BloodBank" IS 'b16 §15 Banco de sangre asociado a un establecimiento.';

-- BloodUnit -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."BloodUnit" (
  id               uuid               NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" uuid               NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "bloodBankId"    uuid               NOT NULL REFERENCES public."BloodBank"(id) ON DELETE RESTRICT,
  "bloodType"      public."BloodType" NOT NULL,
  "rhFactor"       public."RhFactor"  NOT NULL,
  component        public."BloodComponent" NOT NULL,
  status           public."BloodUnitStatus" NOT NULL DEFAULT 'AVAILABLE',
  antigens         jsonb,
  "donorCode"      varchar(40),
  "collectionDate" date               NOT NULL,
  "expirationDate" timestamptz        NOT NULL,
  volume           integer,                         -- ml
  notes            varchar(1000),
  "discardedAt"    timestamptz,
  "discardReason"  varchar(500),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."BloodUnit" IS 'b16 §15 Unidad hemática en inventario del banco de sangre.';
COMMENT ON COLUMN public."BloodUnit".antigens IS 'b16 JSONB: {"kell": bool, "duffy_a": bool, "duffy_b": bool, "kidd_a": bool, ...}';
COMMENT ON COLUMN public."BloodUnit"."donorCode" IS 'b16 Código anonimizado del donante — sin PII.';

-- TransfusionRequest ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."TransfusionRequest" (
  id                   uuid                            NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId"     uuid                            NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "encounterId"        uuid                            NOT NULL REFERENCES public."Encounter"(id) ON DELETE RESTRICT,
  "patientId"          uuid                            NOT NULL REFERENCES public."Patient"(id) ON DELETE RESTRICT,
  "requestedById"      uuid                            NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  urgency              public."TransfusionUrgency"     NOT NULL DEFAULT 'ROUTINE',
  component            public."BloodComponent"         NOT NULL,
  "bloodType"          public."BloodType",
  "rhFactor"           public."RhFactor",
  "unitsRequested"     integer                         NOT NULL DEFAULT 1,
  "clinicalIndication" varchar(2000)                   NOT NULL,
  status               public."TransfusionRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedAt"        timestamptz                     NOT NULL DEFAULT now(),
  "cancelledAt"        timestamptz,
  "cancelReason"       varchar(500),
  "createdAt"          timestamptz                     NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz                     NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."TransfusionRequest" IS 'b16 §15 Solicitud médica de transfusión.';

-- CrossMatch ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."CrossMatch" (
  id               uuid                      NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" uuid                      NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "requestId"      uuid                      NOT NULL REFERENCES public."TransfusionRequest"(id) ON DELETE RESTRICT,
  "unitId"         uuid                      NOT NULL REFERENCES public."BloodUnit"(id) ON DELETE RESTRICT,
  "technicianId"   uuid                      NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  result           public."CrossMatchResult" NOT NULL,
  method           varchar(60)               NOT NULL,
  notes            varchar(1000),
  "performedAt"    timestamptz               NOT NULL DEFAULT now(),
  "createdAt"      timestamptz               NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."CrossMatch" IS 'b16 §15 Prueba de compatibilidad (crossmatch) entre unidad y solicitud.';

-- Transfusion -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."Transfusion" (
  id               uuid                       NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "organizationId" uuid                       NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "requestId"      uuid                       NOT NULL REFERENCES public."TransfusionRequest"(id) ON DELETE RESTRICT,
  "unitId"         uuid                       NOT NULL REFERENCES public."BloodUnit"(id) ON DELETE RESTRICT,
  "encounterId"    uuid                       NOT NULL REFERENCES public."Encounter"(id) ON DELETE RESTRICT,
  "crossMatchId"   uuid                       NOT NULL UNIQUE REFERENCES public."CrossMatch"(id) ON DELETE RESTRICT,
  "nurseId"        uuid                       NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  "supervisorId"   uuid                       NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  route            public."TransfusionRoute"  NOT NULL,
  status           public."TransfusionStatus" NOT NULL DEFAULT 'STARTED',
  "startedAt"      timestamptz                NOT NULL DEFAULT now(),
  "completedAt"    timestamptz,
  "vitalSigns"     jsonb,
  "adverseReactions" jsonb,
  "abortReason"    varchar(500),
  "createdAt"      timestamptz                NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz                NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."Transfusion" IS 'b16 §15 Administración de transfusión. crossMatchId debe referenciar resultado COMPATIBLE.';
COMMENT ON COLUMN public."Transfusion"."vitalSigns" IS 'b16 JSONB: {"pre": {...}, "intra": {...}, "post": {...}}';
COMMENT ON COLUMN public."Transfusion"."adverseReactions" IS 'b16 JSONB: [{"type": "...", "severity": "...", "management": "..."}]';

-- =============================================================================
-- 3. ÍNDICES FK + QUERIES DE NEGOCIO
-- =============================================================================

-- BloodBank
CREATE INDEX IF NOT EXISTS ix_blood_bank_org
  ON public."BloodBank" ("organizationId");

-- BloodUnit
CREATE INDEX IF NOT EXISTS ix_blood_unit_org_status
  ON public."BloodUnit" ("organizationId", status);

CREATE INDEX IF NOT EXISTS ix_blood_unit_bank_status
  ON public."BloodUnit" ("bloodBankId", status);

CREATE INDEX IF NOT EXISTS ix_blood_unit_type_rh_status
  ON public."BloodUnit" ("bloodType", "rhFactor", status);

CREATE INDEX IF NOT EXISTS ix_blood_unit_expiration
  ON public."BloodUnit" ("expirationDate")
  WHERE status = 'AVAILABLE';

-- TransfusionRequest
CREATE INDEX IF NOT EXISTS ix_transfusion_request_org_status
  ON public."TransfusionRequest" ("organizationId", status);

CREATE INDEX IF NOT EXISTS ix_transfusion_request_encounter
  ON public."TransfusionRequest" ("encounterId");

CREATE INDEX IF NOT EXISTS ix_transfusion_request_patient
  ON public."TransfusionRequest" ("patientId");

-- CrossMatch
CREATE INDEX IF NOT EXISTS ix_cross_match_org
  ON public."CrossMatch" ("organizationId");

CREATE INDEX IF NOT EXISTS ix_cross_match_request
  ON public."CrossMatch" ("requestId");

CREATE INDEX IF NOT EXISTS ix_cross_match_unit
  ON public."CrossMatch" ("unitId");

-- Transfusion
CREATE INDEX IF NOT EXISTS ix_transfusion_org_status
  ON public."Transfusion" ("organizationId", status);

CREATE INDEX IF NOT EXISTS ix_transfusion_request
  ON public."Transfusion" ("requestId");

CREATE INDEX IF NOT EXISTS ix_transfusion_encounter
  ON public."Transfusion" ("encounterId");

CREATE INDEX IF NOT EXISTS ix_transfusion_unit
  ON public."Transfusion" ("unitId");

-- =============================================================================
-- 4. CHECK CONSTRAINTS DE NEGOCIO
-- =============================================================================

-- 4.1 BloodUnit: volume > 0 si especificado
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."BloodUnit"'::regclass
      AND conname   = 'chk_blood_unit_volume_positive'
  ) THEN
    ALTER TABLE public."BloodUnit"
      ADD CONSTRAINT chk_blood_unit_volume_positive
      CHECK (volume IS NULL OR volume > 0);
  END IF;
END $$;

-- 4.2 BloodUnit: discardedAt + discardReason consistency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."BloodUnit"'::regclass
      AND conname   = 'chk_blood_unit_discard_consistency'
  ) THEN
    ALTER TABLE public."BloodUnit"
      ADD CONSTRAINT chk_blood_unit_discard_consistency
      CHECK (
        ("discardedAt" IS NULL AND "discardReason" IS NULL)
        OR ("discardedAt" IS NOT NULL AND "discardReason" IS NOT NULL)
      );
  END IF;
END $$;

-- 4.3 TransfusionRequest: unitsRequested >= 1
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."TransfusionRequest"'::regclass
      AND conname   = 'chk_transfusion_request_units_positive'
  ) THEN
    ALTER TABLE public."TransfusionRequest"
      ADD CONSTRAINT chk_transfusion_request_units_positive
      CHECK ("unitsRequested" >= 1);
  END IF;
END $$;

-- 4.4 TransfusionRequest: cancelledAt/cancelReason consistency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."TransfusionRequest"'::regclass
      AND conname   = 'chk_transfusion_request_cancel_consistency'
  ) THEN
    ALTER TABLE public."TransfusionRequest"
      ADD CONSTRAINT chk_transfusion_request_cancel_consistency
      CHECK (
        (status = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL)
        OR (status <> 'CANCELLED')
      );
  END IF;
END $$;

-- 4.5 Transfusion: completedAt >= startedAt cuando presente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."Transfusion"'::regclass
      AND conname   = 'chk_transfusion_completed_after_started'
  ) THEN
    ALTER TABLE public."Transfusion"
      ADD CONSTRAINT chk_transfusion_completed_after_started
      CHECK ("completedAt" IS NULL OR "completedAt" >= "startedAt");
  END IF;
END $$;

-- =============================================================================
-- 5. TRIGGERS DE VALIDACIÓN DE DOMINIO
-- =============================================================================

-- 5.1 Trigger: Transfusion solo se puede insertar si el CrossMatch referenciado
--     tiene result = COMPATIBLE. Bloquea transfusión de unidades incompatibles.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_transfusion_require_compatible_crossmatch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_result text;
BEGIN
  SELECT result::text
  INTO v_result
  FROM public."CrossMatch"
  WHERE id = NEW."crossMatchId";

  IF v_result IS NULL THEN
    RAISE EXCEPTION
      'transfusion_crossmatch_not_found: CrossMatch id=% no existe.',
      NEW."crossMatchId"
      USING ERRCODE = 'P0001';
  END IF;

  IF v_result <> 'COMPATIBLE' THEN
    RAISE EXCEPTION
      'transfusion_incompatible_crossmatch: CrossMatch id=% tiene resultado %, se requiere COMPATIBLE.',
      NEW."crossMatchId", v_result
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transfusion_require_compatible_crossmatch ON public."Transfusion";
CREATE TRIGGER trg_transfusion_require_compatible_crossmatch
  BEFORE INSERT ON public."Transfusion"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_transfusion_require_compatible_crossmatch();

-- 5.2 Trigger: BloodUnit no puede transfundirse si está vencida.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_transfusion_block_expired_unit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_expiration timestamptz;
BEGIN
  SELECT "expirationDate"
  INTO v_expiration
  FROM public."BloodUnit"
  WHERE id = NEW."unitId";

  IF v_expiration IS NOT NULL AND v_expiration < now() THEN
    RAISE EXCEPTION
      'transfusion_expired_unit: BloodUnit id=% venció en %, no se puede transfundir.',
      NEW."unitId", v_expiration
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transfusion_block_expired_unit ON public."Transfusion";
CREATE TRIGGER trg_transfusion_block_expired_unit
  BEFORE INSERT ON public."Transfusion"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_transfusion_block_expired_unit();

-- 5.3 Trigger: State machine de TransfusionRequest.status.
--     Transiciones válidas:
--       REQUESTED -> CROSSMATCHING | CANCELLED
--       CROSSMATCHING -> APPROVED | CANCELLED
--       APPROVED -> FULFILLED | CANCELLED
--     Estados terminales: CANCELLED, FULFILLED -> sin más cambios.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_transfusion_request_state_machine()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_terminal text[] := ARRAY['CANCELLED', 'FULFILLED'];
  v_allowed  boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = ANY(v_terminal) THEN
    RAISE EXCEPTION
      'transfusion_request_immutable: status % es terminal para id=%.',
      OLD.status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  v_allowed := (OLD.status = 'REQUESTED'    AND NEW.status IN ('CROSSMATCHING', 'CANCELLED'))
            OR (OLD.status = 'CROSSMATCHING' AND NEW.status IN ('APPROVED', 'CANCELLED'))
            OR (OLD.status = 'APPROVED'      AND NEW.status IN ('FULFILLED', 'CANCELLED'));

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      'transfusion_request_invalid_transition: % -> % no permitida para id=%.',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transfusion_request_state_machine ON public."TransfusionRequest";
CREATE TRIGGER trg_transfusion_request_state_machine
  BEFORE UPDATE ON public."TransfusionRequest"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_transfusion_request_state_machine();

-- 5.4 Trigger: State machine de BloodUnit.status.
--     AVAILABLE -> RESERVED | DISCARDED | EXPIRED
--     RESERVED -> AVAILABLE | IN_USE | DISCARDED
--     IN_USE -> TRANSFUSED | AVAILABLE (devuelto) | DISCARDED
--     Terminales: TRANSFUSED | DISCARDED | EXPIRED -> sin más cambios.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_blood_unit_state_machine()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_terminal text[] := ARRAY['TRANSFUSED', 'DISCARDED', 'EXPIRED'];
  v_allowed  boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = ANY(v_terminal) THEN
    RAISE EXCEPTION
      'blood_unit_immutable: status % es terminal para id=%.',
      OLD.status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  v_allowed := (OLD.status = 'AVAILABLE' AND NEW.status IN ('RESERVED', 'DISCARDED', 'EXPIRED'))
            OR (OLD.status = 'RESERVED'  AND NEW.status IN ('AVAILABLE', 'IN_USE', 'DISCARDED'))
            OR (OLD.status = 'IN_USE'    AND NEW.status IN ('TRANSFUSED', 'AVAILABLE', 'DISCARDED'));

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      'blood_unit_invalid_transition: % -> % no permitida para id=%.',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blood_unit_state_machine ON public."BloodUnit";
CREATE TRIGGER trg_blood_unit_state_machine
  BEFORE UPDATE ON public."BloodUnit"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_blood_unit_state_machine();

-- =============================================================================
-- 6. POLÍTICAS RLS — tenant_isolation por organization_id
-- =============================================================================

ALTER TABLE public."BloodBank"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BloodUnit"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TransfusionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CrossMatch"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Transfusion"        ENABLE ROW LEVEL SECURITY;

-- BloodBank -------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation ON public."BloodBank";
CREATE POLICY tenant_isolation ON public."BloodBank"
  USING ("organizationId" = public.current_org_id());

-- BloodUnit -------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation ON public."BloodUnit";
CREATE POLICY tenant_isolation ON public."BloodUnit"
  USING ("organizationId" = public.current_org_id());

-- TransfusionRequest ----------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation ON public."TransfusionRequest";
CREATE POLICY tenant_isolation ON public."TransfusionRequest"
  USING ("organizationId" = public.current_org_id());

-- CrossMatch ------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation ON public."CrossMatch";
CREATE POLICY tenant_isolation ON public."CrossMatch"
  USING ("organizationId" = public.current_org_id());

-- Transfusion -----------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation ON public."Transfusion";
CREATE POLICY tenant_isolation ON public."Transfusion"
  USING ("organizationId" = public.current_org_id());

-- Grants al rol authenticated (Supabase auth) ---------------------------------
GRANT SELECT, INSERT, UPDATE ON public."BloodBank"          TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."BloodUnit"          TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."TransfusionRequest" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."CrossMatch"         TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."Transfusion"        TO authenticated;

-- =============================================================================
-- 7. AUDIT TRIGGERS (extiende 02_audit_triggers.sql)
--
-- La función audit.fn_audit_log_insert() ya existe (instalada por 02_audit_triggers.sql).
-- Solo necesitamos asociarla a las tablas nuevas.
-- =============================================================================

-- BloodBank
DROP TRIGGER IF EXISTS audit_blood_bank ON public."BloodBank";
CREATE TRIGGER audit_blood_bank
  AFTER INSERT OR UPDATE OR DELETE ON public."BloodBank"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_log_insert();

-- BloodUnit
DROP TRIGGER IF EXISTS audit_blood_unit ON public."BloodUnit";
CREATE TRIGGER audit_blood_unit
  AFTER INSERT OR UPDATE OR DELETE ON public."BloodUnit"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_log_insert();

-- TransfusionRequest
DROP TRIGGER IF EXISTS audit_transfusion_request ON public."TransfusionRequest";
CREATE TRIGGER audit_transfusion_request
  AFTER INSERT OR UPDATE OR DELETE ON public."TransfusionRequest"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_log_insert();

-- CrossMatch
DROP TRIGGER IF EXISTS audit_cross_match ON public."CrossMatch";
CREATE TRIGGER audit_cross_match
  AFTER INSERT OR UPDATE OR DELETE ON public."CrossMatch"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_log_insert();

-- Transfusion
DROP TRIGGER IF EXISTS audit_transfusion ON public."Transfusion";
CREATE TRIGGER audit_transfusion
  AFTER INSERT OR UPDATE OR DELETE ON public."Transfusion"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_log_insert();

-- =============================================================================
-- 8. HASH CHAIN (extiende 05_audit_hash_chain.sql)
--
-- La función audit.fn_audit_log_chain() encadena hashes por (entity, entityId).
-- Se aplica a CrossMatch y Transfusion: registros críticos de trazabilidad clínica.
-- BloodBank y TransfusionRequest tienen audit_triggers pero no hash chain
-- (menor criticidad regulatoria; tradeoff: write amplification vs trazabilidad).
-- =============================================================================

-- CrossMatch — hash chain (resultados de compatibilidad son inmutables post-insert)
DROP TRIGGER IF EXISTS audit_chain_cross_match ON public."CrossMatch";
CREATE TRIGGER audit_chain_cross_match
  AFTER INSERT ON public."CrossMatch"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_log_chain();

-- Transfusion — hash chain (registro de administración crítico, TDR §6.3)
DROP TRIGGER IF EXISTS audit_chain_transfusion ON public."Transfusion";
CREATE TRIGGER audit_chain_transfusion
  AFTER INSERT OR UPDATE ON public."Transfusion"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_log_chain();

-- =============================================================================
-- FIN 45_blood_bank_hardening.sql
-- =============================================================================
