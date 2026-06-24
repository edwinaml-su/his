-- =============================================================================
-- 178_cc0002_cuenta_servicio.sql
-- CC-0002 Sprint C — Cuentas y Servicios de Paciente (§7)
-- Propósito: Crea el enum TipoServicio, las tablas PatientAccount y
--   PatientAccountService, la secuencia atómica por paciente, la función
--   generadora fn_next_cuenta (SECURITY DEFINER) y las policies RLS
--   (multitenancy §13.7). Idempotente.
-- Aplicar vía: Supabase SQL Editor o MCP execute_sql / apply_migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum TipoServicio
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'TipoServicio' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public."TipoServicio" AS ENUM ('HOSPITALARIO', 'NO_HOSPITALARIO');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Tabla PatientAccount
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."PatientAccount" (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid       NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "patientId"     uuid        NOT NULL REFERENCES public."Patient"(id)       ON DELETE RESTRICT,
  "numeroCuenta"  varchar(20) NOT NULL,
  "encounterId"   uuid        REFERENCES public."Encounter"(id)              ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "createdBy"     uuid,
  CONSTRAINT uq_patient_account UNIQUE ("patientId", "numeroCuenta")
);

CREATE INDEX IF NOT EXISTS idx_patient_account_org
  ON public."PatientAccount" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_patient_account_patient
  ON public."PatientAccount" ("patientId");
CREATE INDEX IF NOT EXISTS idx_patient_account_encounter
  ON public."PatientAccount" ("encounterId")
  WHERE "encounterId" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Tabla PatientAccountService
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."PatientAccountService" (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId"   uuid        NOT NULL REFERENCES public."PatientAccount"(id) ON DELETE CASCADE,
  tipo          public."TipoServicio" NOT NULL,
  descripcion   varchar(300),
  "encounterId" uuid        REFERENCES public."Encounter"(id) ON DELETE SET NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "createdBy"   uuid
);

CREATE INDEX IF NOT EXISTS idx_patient_account_service_account
  ON public."PatientAccountService" ("accountId");
CREATE INDEX IF NOT EXISTS idx_patient_account_service_encounter
  ON public."PatientAccountService" ("encounterId")
  WHERE "encounterId" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Tabla de secuencia por paciente (correlativo atómico)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.secuencia_cuenta (
  patient_id  uuid PRIMARY KEY,
  last_value  int  NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- 5. Función generadora atómica (upsert → no hay race condition)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_next_cuenta(p_patient_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v int;
BEGIN
  INSERT INTO public.secuencia_cuenta (patient_id, last_value)
    VALUES (p_patient_id, 1)
  ON CONFLICT (patient_id)
    DO UPDATE SET last_value = public.secuencia_cuenta.last_value + 1
  RETURNING last_value INTO v;
  RETURN v;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. RLS — PatientAccount (tenant por organizationId directo)
-- -----------------------------------------------------------------------------
ALTER TABLE public."PatientAccount" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_account_tenant ON public."PatientAccount";
CREATE POLICY patient_account_tenant ON public."PatientAccount"
  FOR ALL TO authenticated
  USING (
    "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
  );

-- -----------------------------------------------------------------------------
-- 7. RLS — PatientAccountService (tenant via join a PatientAccount)
-- -----------------------------------------------------------------------------
ALTER TABLE public."PatientAccountService" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_account_service_tenant ON public."PatientAccountService";
CREATE POLICY patient_account_service_tenant ON public."PatientAccountService"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."PatientAccount" a
      WHERE a.id = "PatientAccountService"."accountId"
        AND a."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public."PatientAccount" a
      WHERE a.id = "PatientAccountService"."accountId"
        AND a."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
    )
  );

-- -----------------------------------------------------------------------------
-- 8. Grants al rol authenticated
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PatientAccount", public."PatientAccountService"
  TO authenticated;
