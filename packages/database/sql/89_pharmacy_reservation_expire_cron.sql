-- =====================================================================
-- 89_pharmacy_reservation_expire_cron.sql
-- US.F2.6.8 — Reserva lógica de serial/lote por paciente.
--
-- Crea la tabla `pharmacy_reservation` en schema public y el job
-- pg_cron que expira reservas sin confirmar cada 5 minutos.
--
-- Tabla:
--   pharmacy_reservation — reserva lógica GTIN+lote+serie → paciente
--
-- Enumeración:
--   PharmacyReservationStatus — RESERVED | CONFIRMED | CANCELLED | EXPIRED
--
-- Job pg_cron (idempotente):
--   Cada 5 min: UPDATE status='EXPIRED' WHERE status='RESERVED' AND expires_at < now()
--   Tras expirar: encola notificación en outbox al farmacéutico de turno.
--
-- RLS: tenant-scoped por organization_id.
--   SELECT/INSERT/UPDATE/DELETE solo para `authenticated` con org vigente.
--
-- Idempotente: CREATE TYPE IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
--   DROP POLICY IF EXISTS + CREATE POLICY, cron.unschedule + cron.schedule.
-- =====================================================================

-- -----------------------------------------------------------------------
-- 0. Extensión pg_cron (necesaria para el job)
-- -----------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA cron;

-- -----------------------------------------------------------------------
-- 1. Enum de estado de reserva
-- -----------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'PharmacyReservationStatus'
      AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    CREATE TYPE public."PharmacyReservationStatus" AS ENUM (
      'RESERVED',
      'CONFIRMED',
      'CANCELLED',
      'EXPIRED'
    );
  END IF;
END$$;

-- -----------------------------------------------------------------------
-- 2. Tabla pharmacy_reservation
--
--   UNIQUE (gtin, lote, serie, status='RESERVED') se implementa con un
--   índice parcial para permitir múltiples CANCELLED/EXPIRED del mismo
--   serial (historial) pero bloquear doble RESERVED simultáneo.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."PharmacyReservation" (
  "id"               uuid                              PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"   uuid                              NOT NULL,
  "pharmacyOrderId"  uuid                              NOT NULL,  -- PharmacyOrder (Prisma)
  "patientId"        uuid                              NOT NULL,
  "gtin"             char(14)                          NOT NULL
                       CHECK ("gtin" ~ '^\d{14}$'),
  "lote"             varchar(80)                       NOT NULL,
  "serie"            varchar(80),                              -- nullable: algunos ítems sin número de serie
  "status"           public."PharmacyReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "expiresAt"        timestamptz                       NOT NULL,  -- now() + 4h al insertar
  "cancelMotivo"     text,                                        -- obligatorio al CANCELAR
  "createdAt"        timestamptz                       NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz                       NOT NULL DEFAULT now()
);

-- Índice parcial: evita doble reserva activa para el mismo serial
CREATE UNIQUE INDEX IF NOT EXISTS uq_pharma_reservation_active
  ON public."PharmacyReservation" ("gtin", "lote", "serie")
  WHERE status = 'RESERVED' AND "serie" IS NOT NULL;

-- Índice para expiración (el job filtra por expires_at + status)
CREATE INDEX IF NOT EXISTS idx_pharma_reservation_expires
  ON public."PharmacyReservation" ("expiresAt")
  WHERE status = 'RESERVED';

-- Índice tenant + paciente (consultas duplicado)
CREATE INDEX IF NOT EXISTS idx_pharma_reservation_org_patient
  ON public."PharmacyReservation" ("organizationId", "patientId");

-- Índice por orden de farmacia
CREATE INDEX IF NOT EXISTS idx_pharma_reservation_order
  ON public."PharmacyReservation" ("pharmacyOrderId");

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_pharma_reservation_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pharma_reservation_updated_at ON public."PharmacyReservation";
CREATE TRIGGER trg_pharma_reservation_updated_at
  BEFORE UPDATE ON public."PharmacyReservation"
  FOR EACH ROW EXECUTE FUNCTION public.set_pharma_reservation_updated_at();

COMMENT ON TABLE public."PharmacyReservation" IS
  'US.F2.6.8 — Reserva lógica de unidad GS1 (GTIN+lote+serie) al paciente durante dispensación. '
  'Expira automáticamente en 4 h si no se confirma. '
  'UNIQUE parcial sobre (gtin, lote, serie) WHERE status=RESERVED previene doble asignación.';

-- -----------------------------------------------------------------------
-- 3. RLS — política tenant-scoped
-- -----------------------------------------------------------------------
ALTER TABLE public."PharmacyReservation" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_pharma_reservation_tenant" ON public."PharmacyReservation";
CREATE POLICY "rls_pharma_reservation_tenant"
  ON public."PharmacyReservation"
  FOR ALL
  TO authenticated
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

COMMENT ON POLICY "rls_pharma_reservation_tenant" ON public."PharmacyReservation" IS
  'Aísla reservas por tenant. Requiere current_org_id() seteado via withTenantContext.';

-- -----------------------------------------------------------------------
-- 4. Función que expira reservas y encola notificación outbox
--
--   Llamada por el job pg_cron cada 5 min.
--   Para cada reserva expirada: UPDATE status → EXPIRED y
--   INSERT en public."NotificationOutbox" al farmacéutico de turno.
--   (La tabla NotificationOutbox es del módulo Beta.15)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_pharmacy_reservations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row public."PharmacyReservation"%ROWTYPE;
BEGIN
  FOR v_row IN
    UPDATE public."PharmacyReservation"
    SET status = 'EXPIRED', "updatedAt" = now()
    WHERE status = 'RESERVED'
      AND "expiresAt" < now()
    RETURNING *
  LOOP
    -- Encolar notificación outbox (Beta.15).
    -- Si la tabla no existe todavía el INSERT falla silenciosamente.
    BEGIN
      INSERT INTO public."NotificationOutbox" (
        "organizationId",
        "channel",
        "payload",
        "createdAt",
        "status"
      ) VALUES (
        v_row."organizationId",
        'PHARMACY',
        jsonb_build_object(
          'event',          'RESERVATION_EXPIRED',
          'reservationId',  v_row."id",
          'pharmacyOrderId', v_row."pharmacyOrderId",
          'patientId',      v_row."patientId",
          'gtin',           v_row."gtin",
          'lote',           v_row."lote",
          'expiredAt',      now()
        ),
        now(),
        'PENDING'
      );
    EXCEPTION WHEN OTHERS THEN
      -- Tabla outbox puede no existir en todos los entornos (CI sin Beta.15).
      NULL;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.expire_pharmacy_reservations() IS
  'Expira reservas RESERVED cuyo expiresAt < now() y encola notificación outbox. '
  'Llamada por pg_cron cada 5 min.';

-- -----------------------------------------------------------------------
-- 5. Job pg_cron — cada 5 minutos
--
--   Idempotente: elimina el job si existía con ese nombre antes de recrear.
-- -----------------------------------------------------------------------
DO $$
BEGIN
  -- Desregistrar si existía para permitir recreación idempotente
  PERFORM cron.unschedule('his-expire-pharmacy-reservations')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'his-expire-pharmacy-reservations'
    );
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron puede no estar disponible en CI
END$$;

SELECT cron.schedule(
  'his-expire-pharmacy-reservations',   -- nombre único del job
  '*/5 * * * *',                        -- cada 5 minutos
  $$SELECT public.expire_pharmacy_reservations();$$
);
