-- =============================================================================
-- F2-S7 GS1 Bedside | PharmacyOrder — Dispensación farmacéutica GS1
-- Sprint F2-S7, Proceso D
--
-- Crea la tabla "PharmacyOrder" con:
--   - RLS por organizationId (mismo patrón que §15 pharmacy_rls.sql)
--   - Audit trigger vía audit.fn_audit_row()
--   - State machine PENDING → DISPENSING → DISPENSED | CANCELLED
--   - Indexes para queries operacionales (status, encounter, patient, GLN)
--
-- Naming: PascalCase tabla, camelCase columnas (Prisma convention).
-- Idempotente: IF NOT EXISTS en tabla + índices; DROP/CREATE en triggers.
-- =============================================================================

-- 1. Enum PharmacyOrderStatus ------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PharmacyOrderStatus') THEN
    CREATE TYPE public."PharmacyOrderStatus" AS ENUM (
      'PENDING',
      'DISPENSING',
      'DISPENSED',
      'CANCELLED'
    );
  END IF;
END $$;

-- 2. Tabla PharmacyOrder -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public."PharmacyOrder" (
  "id"             uuid        NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" uuid        NOT NULL,
  "encounterId"    uuid        NOT NULL,
  "medicalOrderId" uuid,
  "patientId"      uuid        NOT NULL,
  "status"         public."PharmacyOrderStatus" NOT NULL DEFAULT 'PENDING',
  -- GLN 13 dígitos (GS1 Global Location Number)
  "glnOrigen"      varchar(13) NOT NULL,
  "glnDestino"     varchar(13) NOT NULL,
  "dispensedAt"    timestamptz,
  "dispensedById"  uuid,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "createdBy"      uuid,
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PharmacyOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PharmacyOrder_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE RESTRICT,
  CONSTRAINT "PharmacyOrder_encounterId_fkey"
    FOREIGN KEY ("encounterId") REFERENCES public."Encounter"("id") ON DELETE RESTRICT,
  CONSTRAINT "PharmacyOrder_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES public."Patient"("id") ON DELETE RESTRICT,
  CONSTRAINT "PharmacyOrder_dispensedById_fkey"
    FOREIGN KEY ("dispensedById") REFERENCES public."User"("id") ON DELETE SET NULL,
  CONSTRAINT "pharmacy_order_gln_origen_format_chk"
    CHECK ("glnOrigen" ~ '^\d{13}$'),
  CONSTRAINT "pharmacy_order_gln_destino_format_chk"
    CHECK ("glnDestino" ~ '^\d{13}$')
);

-- 3. Índices operacionales ----------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_pharmacy_order_org_status
  ON public."PharmacyOrder" ("organizationId", "status");

CREATE INDEX IF NOT EXISTS ix_pharmacy_order_encounter
  ON public."PharmacyOrder" ("encounterId");

CREATE INDEX IF NOT EXISTS ix_pharmacy_order_patient
  ON public."PharmacyOrder" ("patientId");

CREATE INDEX IF NOT EXISTS ix_pharmacy_order_gln_origen
  ON public."PharmacyOrder" ("glnOrigen");

CREATE INDEX IF NOT EXISTS ix_pharmacy_order_gln_destino
  ON public."PharmacyOrder" ("glnDestino");

-- 4. updatedAt automático ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_updated_at_pharmacy_order()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_pharmacy_order_updated_at ON public."PharmacyOrder";
CREATE TRIGGER tr_pharmacy_order_updated_at
  BEFORE UPDATE ON public."PharmacyOrder"
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at_pharmacy_order();

-- 5. State machine PENDING → DISPENSING → DISPENSED | CANCELLED ---------------
CREATE OR REPLACE FUNCTION public.fn_validate_pharmacy_order_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  v_allowed :=
    (OLD.status = 'PENDING'    AND NEW.status IN ('DISPENSING', 'CANCELLED'))
 OR (OLD.status = 'DISPENSING' AND NEW.status IN ('DISPENSED',  'CANCELLED'));
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transición inválida PharmacyOrder.status: % → %',
      OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_pharmacy_order_status_transition ON public."PharmacyOrder";
CREATE TRIGGER tr_pharmacy_order_status_transition
  BEFORE UPDATE ON public."PharmacyOrder"
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_pharmacy_order_status_transition();

-- 6. Audit trigger (reusa audit.fn_audit_row de 02_audit_triggers.sql) --------
DROP TRIGGER IF EXISTS tr_audit_pharmacy_order ON public."PharmacyOrder";
CREATE TRIGGER tr_audit_pharmacy_order
  AFTER INSERT OR UPDATE OR DELETE ON public."PharmacyOrder"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- 7. RLS — tenant-scoped por organizationId -----------------------------------
ALTER TABLE public."PharmacyOrder" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PharmacyOrder_tenant_isolation" ON public."PharmacyOrder";
CREATE POLICY "PharmacyOrder_tenant_isolation"
  ON public."PharmacyOrder"
  FOR ALL
  TO authenticated
  USING (
    "organizationId" = nullif(
      current_setting('app.current_org_id', true), ''
    )::uuid
  )
  WITH CHECK (
    "organizationId" = nullif(
      current_setting('app.current_org_id', true), ''
    )::uuid
  );

-- Service role bypasses RLS (BYPASSRLS por default en Supabase postgres role)
-- No se necesita política adicional para service_role.

-- 8. Columna gsrn en Patient (extensión GS1 pulsera) --------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'Patient'
      AND column_name  = 'gsrn'
  ) THEN
    ALTER TABLE public."Patient"
      ADD COLUMN "gsrn" varchar(18);
    CREATE UNIQUE INDEX IF NOT EXISTS ix_patient_gsrn
      ON public."Patient" ("gsrn")
      WHERE "gsrn" IS NOT NULL;
    COMMENT ON COLUMN public."Patient"."gsrn"
      IS 'GS1 GSRN 18-digit — identificador pulsera bedside (F2-S7).';
  END IF;
END $$;
