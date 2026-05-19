-- =============================================================================
-- HIS Multi-país | §16 NTEC Anatomía Patológica — Tablas base (DDL)
-- Sprint S7, HH-16 — Opción A: Crear las 5 tablas que pathology.router.ts asume.
--
-- Tablas creadas:
--   PathologyOrder          — solicitud médica de estudio (state machine §16)
--   PathologySpecimen       — muestra recibida en el laboratorio
--   PathologyMacroDescription — descripción macroscópica del espécimen
--   PathologyMicroDescription — descripción microscópica del espécimen
--   PathologyReport         — reporte final firmado (inmutable post-sign, ADR 0004)
--
-- Enums creados:
--   PathologyStudyType      — HISTOPATHOLOGY | CYTOLOGY | BIOPSY | IMMUNOHISTOCHEMISTRY | AUTOPSY
--   PathologyOrderStatus    — REQUESTED | COLLECTING | IN_PROCESS | REPORTED | CANCELLED
--   SpecimenStatus          — RECEIVED | GROSSING | PROCESSED | REPORTED | ARCHIVED | DISCARDED
--   ReportStatus            — DRAFT | PRELIMINARY | FINAL | AMENDED
--
-- Derivado 1:1 de packages/database/prisma/schema.prisma (modelos Pathology*).
-- Aplicado vía mcp__supabase__apply_migration (2026-05-19).
-- El hardening RLS + audit + hash chain está en 46_pathology_hardening.sql
-- (re-aplicado como 46_pathology_hardening_apply).
-- =============================================================================

-- 1. Enums -------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public."PathologyStudyType" AS ENUM (
    'HISTOPATHOLOGY', 'CYTOLOGY', 'BIOPSY', 'IMMUNOHISTOCHEMISTRY', 'AUTOPSY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public."PathologyOrderStatus" AS ENUM (
    'REQUESTED', 'COLLECTING', 'IN_PROCESS', 'REPORTED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public."SpecimenStatus" AS ENUM (
    'RECEIVED', 'GROSSING', 'PROCESSED', 'REPORTED', 'ARCHIVED', 'DISCARDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public."ReportStatus" AS ENUM (
    'DRAFT', 'PRELIMINARY', 'FINAL', 'AMENDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. PathologyOrder ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PathologyOrder" (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"        uuid          NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "encounterId"           uuid          NOT NULL REFERENCES public."Encounter"(id)    ON DELETE RESTRICT,
  "patientId"             uuid          NOT NULL REFERENCES public."Patient"(id)      ON DELETE RESTRICT,
  "requestingPhysicianId" uuid          NOT NULL REFERENCES public."User"(id)         ON DELETE RESTRICT,
  "studyType"             public."PathologyStudyType" NOT NULL,
  "clinicalIndication"    text,
  "suspectedDiagnosis"    varchar(500),
  priority                varchar(20)   NOT NULL DEFAULT 'ROUTINE',
  status                  public."PathologyOrderStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedAt"           timestamptz   NOT NULL DEFAULT now(),
  "createdAt"             timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"             timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PathologyOrder_organizationId_status_idx"
  ON public."PathologyOrder" ("organizationId", status);
CREATE INDEX IF NOT EXISTS "PathologyOrder_encounterId_idx"
  ON public."PathologyOrder" ("encounterId");
CREATE INDEX IF NOT EXISTS "PathologyOrder_patientId_idx"
  ON public."PathologyOrder" ("patientId");
CREATE INDEX IF NOT EXISTS "PathologyOrder_requestingPhysicianId_idx"
  ON public."PathologyOrder" ("requestingPhysicianId");

-- 3. PathologySpecimen -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PathologySpecimen" (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId"         uuid          NOT NULL REFERENCES public."PathologyOrder"(id) ON DELETE RESTRICT,
  "anatomicSite"    varchar(300)  NOT NULL,
  "snomedCode"      varchar(20),
  "collectionMethod" varchar(100),
  fixative          varchar(40)   NOT NULL DEFAULT 'FORMALIN',
  "blockCount"      integer       NOT NULL DEFAULT 0,
  "slideCount"      integer       NOT NULL DEFAULT 0,
  "receivedAt"      timestamptz   NOT NULL DEFAULT now(),
  "receivedById"    uuid          NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  status            public."SpecimenStatus" NOT NULL DEFAULT 'RECEIVED',
  "createdAt"       timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PathologySpecimen_orderId_idx"
  ON public."PathologySpecimen" ("orderId");

-- 4. PathologyMacroDescription -----------------------------------------------

CREATE TABLE IF NOT EXISTS public."PathologyMacroDescription" (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "specimenId"    uuid          NOT NULL REFERENCES public."PathologySpecimen"(id) ON DELETE RESTRICT,
  "pathologistId" uuid          NOT NULL REFERENCES public."User"(id)              ON DELETE RESTRICT,
  description     text          NOT NULL,
  dimensions      varchar(100),
  "weightGrams"   numeric(8,2),
  color           varchar(100),
  "photoUrls"     text[]        NOT NULL DEFAULT '{}',
  "createdAt"     timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PathologyMacroDescription_specimenId_idx"
  ON public."PathologyMacroDescription" ("specimenId");

-- 5. PathologyMicroDescription -----------------------------------------------

CREATE TABLE IF NOT EXISTS public."PathologyMicroDescription" (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "specimenId"    uuid          NOT NULL REFERENCES public."PathologySpecimen"(id) ON DELETE RESTRICT,
  "pathologistId" uuid          NOT NULL REFERENCES public."User"(id)              ON DELETE RESTRICT,
  description     text          NOT NULL,
  stains          text[]        NOT NULL DEFAULT '{}',
  "createdAt"     timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PathologyMicroDescription_specimenId_idx"
  ON public."PathologyMicroDescription" ("specimenId");

-- 6. PathologyReport ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PathologyReport" (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"     uuid          NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "orderId"            uuid          NOT NULL REFERENCES public."PathologyOrder"(id) ON DELETE RESTRICT,
  "pathologistId"      uuid          NOT NULL REFERENCES public."User"(id)          ON DELETE RESTRICT,
  "primaryDiagnosis"   text          NOT NULL,
  "secondaryDiagnoses" text[]        NOT NULL DEFAULT '{}',
  "diagnosisCodes"     text[]        NOT NULL DEFAULT '{}',
  "tnmStaging"         varchar(50),
  "tumorGrade"         varchar(20),
  "criticalFinding"    boolean       NOT NULL DEFAULT false,
  status               public."ReportStatus" NOT NULL DEFAULT 'DRAFT',
  "signedAt"           timestamptz,
  "amendmentReason"    text,
  "amendedFromId"      uuid          REFERENCES public."PathologyReport"(id),
  "prevHash"           varchar(64),
  "signatureHash"      varchar(64),
  "createdAt"          timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PathologyReport_organizationId_status_idx"
  ON public."PathologyReport" ("organizationId", status);
CREATE INDEX IF NOT EXISTS "PathologyReport_orderId_idx"
  ON public."PathologyReport" ("orderId");

-- 7. Grants a rol authenticated ----------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PathologyOrder",
     public."PathologySpecimen",
     public."PathologyMacroDescription",
     public."PathologyMicroDescription",
     public."PathologyReport"
  TO authenticated;

-- 8. updatedAt auto-update trigger -------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_set_updated_at_pathology()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW."updatedAt" := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_set_updated_at_pathology_order ON public."PathologyOrder";
CREATE TRIGGER trg_set_updated_at_pathology_order
  BEFORE UPDATE ON public."PathologyOrder"
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at_pathology();

DROP TRIGGER IF EXISTS trg_set_updated_at_pathology_specimen ON public."PathologySpecimen";
CREATE TRIGGER trg_set_updated_at_pathology_specimen
  BEFORE UPDATE ON public."PathologySpecimen"
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at_pathology();

DROP TRIGGER IF EXISTS trg_set_updated_at_pathology_macro ON public."PathologyMacroDescription";
CREATE TRIGGER trg_set_updated_at_pathology_macro
  BEFORE UPDATE ON public."PathologyMacroDescription"
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at_pathology();

DROP TRIGGER IF EXISTS trg_set_updated_at_pathology_micro ON public."PathologyMicroDescription";
CREATE TRIGGER trg_set_updated_at_pathology_micro
  BEFORE UPDATE ON public."PathologyMicroDescription"
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at_pathology();

DROP TRIGGER IF EXISTS trg_set_updated_at_pathology_report ON public."PathologyReport";
CREATE TRIGGER trg_set_updated_at_pathology_report
  BEFORE UPDATE ON public."PathologyReport"
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at_pathology();
