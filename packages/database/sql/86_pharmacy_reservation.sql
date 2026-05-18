-- =============================================================================
-- F2-S7 GS1 Bedside | PharmacyReservation — Reserva de unidades GS1
-- Sprint F2-S7, Proceso D
--
-- Crea la tabla "PharmacyReservation" con:
--   - RLS por organizationId
--   - Audit trigger
--   - Índice expiresAt para job cron de expiración (pg_cron)
--   - State machine RESERVED → DISPATCHED | EXPIRED | CANCELLED
--
-- Idempotente.
-- =============================================================================

-- 1. Enum PharmacyReservationStatus ------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PharmacyReservationStatus') THEN
    CREATE TYPE public."PharmacyReservationStatus" AS ENUM (
      'RESERVED',
      'DISPATCHED',
      'EXPIRED',
      'CANCELLED'
    );
  END IF;
END $$;

-- 2. Tabla PharmacyReservation ------------------------------------------------
CREATE TABLE IF NOT EXISTS public."PharmacyReservation" (
  "id"              uuid        NOT NULL DEFAULT gen_random_uuid(),
  "organizationId"  uuid        NOT NULL,
  "pharmacyOrderId" uuid        NOT NULL,
  "patientId"       uuid        NOT NULL,
  -- GTIN-14 (padded con ceros a la izquierda si es GTIN-8/12/13)
  "gtin"            varchar(14) NOT NULL,
  "lote"            varchar(60),
  "serie"           varchar(60),
  "status"          public."PharmacyReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "expiresAt"       timestamptz NOT NULL,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PharmacyReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PharmacyReservation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE RESTRICT,
  CONSTRAINT "PharmacyReservation_pharmacyOrderId_fkey"
    FOREIGN KEY ("pharmacyOrderId") REFERENCES public."PharmacyOrder"("id") ON DELETE RESTRICT,
  CONSTRAINT "PharmacyReservation_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES public."Patient"("id") ON DELETE RESTRICT,
  CONSTRAINT "pharmacy_reservation_gtin_format_chk"
    CHECK ("gtin" ~ '^\d{14}$'),
  CONSTRAINT "pharmacy_reservation_expires_future_chk"
    CHECK ("expiresAt" > "createdAt")
);

-- 3. Índices operacionales ----------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_pharmacy_reservation_org_status
  ON public."PharmacyReservation" ("organizationId", "status");

CREATE INDEX IF NOT EXISTS ix_pharmacy_reservation_order
  ON public."PharmacyReservation" ("pharmacyOrderId");

CREATE INDEX IF NOT EXISTS ix_pharmacy_reservation_patient
  ON public."PharmacyReservation" ("patientId");

-- Índice primario para el job cron que expira reservas vencidas.
CREATE INDEX IF NOT EXISTS ix_pharmacy_reservation_expires_at
  ON public."PharmacyReservation" ("expiresAt")
  WHERE "status" = 'RESERVED';

CREATE INDEX IF NOT EXISTS ix_pharmacy_reservation_gtin
  ON public."PharmacyReservation" ("gtin");

-- 4. State machine RESERVED → DISPATCHED | EXPIRED | CANCELLED ---------------
CREATE OR REPLACE FUNCTION public.fn_validate_pharmacy_reservation_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  v_allowed :=
    (OLD.status = 'RESERVED' AND NEW.status IN ('DISPATCHED', 'EXPIRED', 'CANCELLED'));
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transición inválida PharmacyReservation.status: % → %',
      OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_pharmacy_reservation_status_transition ON public."PharmacyReservation";
CREATE TRIGGER tr_pharmacy_reservation_status_transition
  BEFORE UPDATE ON public."PharmacyReservation"
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_pharmacy_reservation_status_transition();

-- 5. Audit trigger ------------------------------------------------------------
DROP TRIGGER IF EXISTS tr_audit_pharmacy_reservation ON public."PharmacyReservation";
CREATE TRIGGER tr_audit_pharmacy_reservation
  AFTER INSERT OR UPDATE OR DELETE ON public."PharmacyReservation"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- 6. RLS ----------------------------------------------------------------------
ALTER TABLE public."PharmacyReservation" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PharmacyReservation_tenant_isolation" ON public."PharmacyReservation";
CREATE POLICY "PharmacyReservation_tenant_isolation"
  ON public."PharmacyReservation"
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

-- 7. Función cron-friendly: expirar reservas vencidas -------------------------
-- El job de pg_cron llama: SELECT public.fn_expire_pharmacy_reservations();
CREATE OR REPLACE FUNCTION public.fn_expire_pharmacy_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public."PharmacyReservation"
    SET "status" = 'EXPIRED'
  WHERE "status" = 'RESERVED'
    AND "expiresAt" <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
COMMENT ON FUNCTION public.fn_expire_pharmacy_reservations()
  IS 'Expira reservas GS1 vencidas. Llamar desde pg_cron cada 5 min. F2-S7.';
