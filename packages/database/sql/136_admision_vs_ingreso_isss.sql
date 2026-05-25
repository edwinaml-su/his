-- =============================================================================
-- 136_admision_vs_ingreso_isss.sql
-- Diferenciación normativa Admisión / Asignación de Cama / Ingreso físico
-- según ISSS MNP-S-138 v3.0 (Mayo 2019).
--
-- Spec: docs/36_admision_vs_ingreso_isss.md
--
-- Migración ADITIVA — todas las columnas nullable para no romper consumidores
-- existentes. La columna `admittedAt` original se conserva como alias semántico
-- de `physicalAdmittedAt` (Hito 3 = inicia día-cama según Norma General 6).
--
-- Aplicado a prod: 2026-05-25 vía MCP (admision_vs_ingreso_isss_2026_05_25).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Columnas por hito en InpatientAdmission
-- ---------------------------------------------------------------------------

ALTER TABLE "InpatientAdmission"
  -- Hito 1 — Admisión (decisión clínica)
  ADD COLUMN IF NOT EXISTS "admissionDecidedAt"   timestamptz,
  ADD COLUMN IF NOT EXISTS "admissionDecidedById" uuid,

  -- Hito 2 — Asignación de cama (reserva operativa)
  ADD COLUMN IF NOT EXISTS "bedAssignedAt"        timestamptz,
  ADD COLUMN IF NOT EXISTS "bedAssignedById"      uuid,
  ADD COLUMN IF NOT EXISTS "bedId"                uuid,

  -- Hito 3 — Ingreso físico (inicia día-cama, ISSS Norma General 6)
  ADD COLUMN IF NOT EXISTS "physicalAdmittedAt"   timestamptz,
  ADD COLUMN IF NOT EXISTS "physicalAdmittedById" uuid,
  ADD COLUMN IF NOT EXISTS "wristbandPlacedAt"    timestamptz,
  ADD COLUMN IF NOT EXISTS "admissionFormNumber"  varchar(40);

COMMENT ON COLUMN "InpatientAdmission"."admissionDecidedAt" IS
  'Hito 1: timestamp de la decisión médica de hospitalizar. ISSS MNP-S-138 §9.1 Norma 2.';
COMMENT ON COLUMN "InpatientAdmission"."admissionDecidedById" IS
  'Hito 1: User.id del médico que indicó el ingreso.';
COMMENT ON COLUMN "InpatientAdmission"."bedAssignedAt" IS
  'Hito 2: timestamp de asignación de cama física. ISSS MNP-S-138 §9.1.';
COMMENT ON COLUMN "InpatientAdmission"."bedAssignedById" IS
  'Hito 2: User.id del médico/enfermera que asignó la cama.';
COMMENT ON COLUMN "InpatientAdmission"."bedId" IS
  'Hito 2: FK a Bed asignada. Permite snapshot histórico aunque la cama luego cambie.';
COMMENT ON COLUMN "InpatientAdmission"."physicalAdmittedAt" IS
  'Hito 3: timestamp de recepción física en sala. INICIA DÍA-CAMA (ISSS Norma General 6, MNP-S-138). Equivalente semántico al admittedAt legacy.';
COMMENT ON COLUMN "InpatientAdmission"."physicalAdmittedById" IS
  'Hito 3: User.id de recepción/enfermería que recibió al paciente.';
COMMENT ON COLUMN "InpatientAdmission"."wristbandPlacedAt" IS
  'Hito 3: timestamp colocación brazalete GSRN. JCI IPSG.1.';
COMMENT ON COLUMN "InpatientAdmission"."admissionFormNumber" IS
  'Hito 3: número de la Hoja SAFISSS 130201132 (Hoja de ingreso, observación, hospitalización y alta).';

-- FK opcional a Bed (puede quedar nullable si la cama fue eliminada)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'InpatientAdmission_bedId_fkey'
      AND table_name = 'InpatientAdmission'
  ) THEN
    ALTER TABLE "InpatientAdmission"
      ADD CONSTRAINT "InpatientAdmission_bedId_fkey"
      FOREIGN KEY ("bedId") REFERENCES "Bed"(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- B. Extender enum InpatientStatus con valores por fase
-- ---------------------------------------------------------------------------
-- Postgres requiere ALTER TYPE ADD VALUE en transacciones separadas para usar
-- los nuevos valores en queries. Estos solo extienden el dominio; no se usan
-- en código todavía (Fase 3 del roadmap).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ADMISSION_DECIDED' AND enumtypid = 'public."InpatientStatus"'::regtype) THEN
    ALTER TYPE "InpatientStatus" ADD VALUE 'ADMISSION_DECIDED' BEFORE 'ACTIVE';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'BED_ASSIGNED' AND enumtypid = 'public."InpatientStatus"'::regtype) THEN
    ALTER TYPE "InpatientStatus" ADD VALUE 'BED_ASSIGNED' BEFORE 'ACTIVE';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DISCHARGE_PENDING' AND enumtypid = 'public."InpatientStatus"'::regtype) THEN
    ALTER TYPE "InpatientStatus" ADD VALUE 'DISCHARGE_PENDING' AFTER 'ACTIVE';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- C. Índices para reportes (tiempo entre hitos)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_inpatient_admission_decided
  ON "InpatientAdmission" ("admissionDecidedAt")
  WHERE "admissionDecidedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inpatient_bed_assigned
  ON "InpatientAdmission" ("bedAssignedAt")
  WHERE "bedAssignedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inpatient_physical_admitted
  ON "InpatientAdmission" ("physicalAdmittedAt")
  WHERE "physicalAdmittedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inpatient_bed
  ON "InpatientAdmission" ("bedId")
  WHERE "bedId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- D. Backfill seguro de timestamps históricos
-- ---------------------------------------------------------------------------
-- Para registros previos a esta migración, asumimos que el `admittedAt` legacy
-- era el ingreso físico (Norma 6) y la decisión clínica fue inmediata anterior.
-- Esto preserva la semántica de día-cama de los reportes existentes.

UPDATE "InpatientAdmission"
SET
  "physicalAdmittedAt"   = COALESCE("physicalAdmittedAt", "admittedAt"),
  "physicalAdmittedById" = COALESCE("physicalAdmittedById", "attendingId"),
  "admissionDecidedAt"   = COALESCE("admissionDecidedAt", "admittedAt"),
  "admissionDecidedById" = COALESCE("admissionDecidedById", "attendingId")
WHERE "physicalAdmittedAt" IS NULL OR "admissionDecidedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- E. Vista de reportes (tiempo entre hitos) para BI
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW "v_inpatient_admission_timeline" AS
SELECT
  ia.id,
  ia."organizationId",
  ia."establishmentId",
  ia."encounterId",
  ia."patientId",
  ia."admissionDecidedAt",
  ia."bedAssignedAt",
  ia."physicalAdmittedAt",
  ia."dischargedAt",
  -- Tiempo decisión → cama asignada (minutos)
  EXTRACT(EPOCH FROM (ia."bedAssignedAt" - ia."admissionDecidedAt")) / 60.0
    AS minutes_decision_to_bed,
  -- Tiempo cama asignada → recepción física (minutos)
  EXTRACT(EPOCH FROM (ia."physicalAdmittedAt" - ia."bedAssignedAt")) / 60.0
    AS minutes_bed_to_physical,
  -- Día-cama real (sólo desde recepción física hasta alta — Norma 6 ISSS)
  CASE
    WHEN ia."physicalAdmittedAt" IS NOT NULL AND ia."dischargedAt" IS NOT NULL
    THEN EXTRACT(EPOCH FROM (ia."dischargedAt" - ia."physicalAdmittedAt")) / 86400.0
    ELSE NULL
  END AS los_days_normative,
  ia.status,
  ia.reason
FROM "InpatientAdmission" ia
WHERE ia."deletedAt" IS NULL;

COMMENT ON VIEW "v_inpatient_admission_timeline" IS
  'Vista BI con tiempos entre hitos del ciclo hospitalario ISSS. los_days_normative cumple Norma General 6 MNP-S-138 (día-cama desde ingreso físico).';
