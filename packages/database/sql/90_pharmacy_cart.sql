-- =============================================================================
-- 90_pharmacy_cart.sql
-- Carrito Unidosis (US.F2.6.12-16) — tablas + RLS
--
-- Tablas: "PharmacyCart" + "PharmacyCartItem" (public schema, Prisma PascalCase).
-- RLS: tenant-scoped por organizationId usando RLS helpers existentes.
-- Nota: enum PharmacyCartStatus debe existir antes de crear la tabla.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PharmacyCartStatus') THEN
    CREATE TYPE public."PharmacyCartStatus" AS ENUM (
      'ARMANDO',
      'LISTO',
      'DESPACHADO',
      'RECIBIDO'
    );
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Tabla principal: PharmacyCart
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PharmacyCart" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID        NOT NULL,
  "turno"          VARCHAR(20) NOT NULL,
  "patientId"      UUID        NOT NULL,
  "glnDestino"     VARCHAR(13) NOT NULL,
  "status"         public."PharmacyCartStatus" NOT NULL DEFAULT 'ARMANDO',
  "dispatchedAt"   TIMESTAMPTZ,
  "dispatchedById" UUID,
  "receivedAt"     TIMESTAMPTZ,
  "receivedById"   UUID,
  "signature"      VARCHAR(2000),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "PharmacyCart_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PharmacyCart_one_per_turno_patient"
    UNIQUE ("organizationId", "turno", "patientId"),
  CONSTRAINT "PharmacyCart_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE RESTRICT,
  CONSTRAINT "PharmacyCart_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES public."Patient"("id") ON DELETE RESTRICT,
  CONSTRAINT "PharmacyCart_dispatchedById_fkey"
    FOREIGN KEY ("dispatchedById") REFERENCES public."User"("id") ON DELETE SET NULL,
  CONSTRAINT "PharmacyCart_receivedById_fkey"
    FOREIGN KEY ("receivedById") REFERENCES public."User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "PharmacyCart_organizationId_status_idx"
  ON public."PharmacyCart"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "PharmacyCart_patientId_idx"
  ON public."PharmacyCart"("patientId");

-- ---------------------------------------------------------------------------
-- Tabla hijo: PharmacyCartItem
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PharmacyCartItem" (
  "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
  "cartId"               UUID        NOT NULL,
  "medicationDispenseId" UUID,
  "gtin"                 VARCHAR(14) NOT NULL,
  "lote"                 VARCHAR(80),
  "serie"                VARCHAR(80),
  "posicionCarrito"      INTEGER     NOT NULL DEFAULT 0,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "PharmacyCartItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PharmacyCartItem_cartId_fkey"
    FOREIGN KEY ("cartId") REFERENCES public."PharmacyCart"("id") ON DELETE CASCADE,
  CONSTRAINT "PharmacyCartItem_medicationDispenseId_fkey"
    FOREIGN KEY ("medicationDispenseId") REFERENCES public."MedicationDispense"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "PharmacyCartItem_cartId_idx"
  ON public."PharmacyCartItem"("cartId");

-- ---------------------------------------------------------------------------
-- updatedAt trigger para PharmacyCart
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_pharmacy_cart_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "PharmacyCart_updatedAt" ON public."PharmacyCart";
CREATE TRIGGER "PharmacyCart_updatedAt"
  BEFORE UPDATE ON public."PharmacyCart"
  FOR EACH ROW EXECUTE FUNCTION public.set_pharmacy_cart_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public."PharmacyCart" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PharmacyCartItem" ENABLE ROW LEVEL SECURITY;

-- PharmacyCart: lectura y escritura solo al tenant activo
DROP POLICY IF EXISTS "PharmacyCart_tenant_select" ON public."PharmacyCart";
CREATE POLICY "PharmacyCart_tenant_select"
  ON public."PharmacyCart" FOR SELECT
  USING (
    "organizationId" = current_setting('app.current_org_id', TRUE)::UUID
    OR current_user = 'postgres'
  );

DROP POLICY IF EXISTS "PharmacyCart_tenant_insert" ON public."PharmacyCart";
CREATE POLICY "PharmacyCart_tenant_insert"
  ON public."PharmacyCart" FOR INSERT
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', TRUE)::UUID
  );

DROP POLICY IF EXISTS "PharmacyCart_tenant_update" ON public."PharmacyCart";
CREATE POLICY "PharmacyCart_tenant_update"
  ON public."PharmacyCart" FOR UPDATE
  USING (
    "organizationId" = current_setting('app.current_org_id', TRUE)::UUID
  );

-- PharmacyCartItem: hereda acceso del carrito padre via JOIN
DROP POLICY IF EXISTS "PharmacyCartItem_tenant_select" ON public."PharmacyCartItem";
CREATE POLICY "PharmacyCartItem_tenant_select"
  ON public."PharmacyCartItem" FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public."PharmacyCart" c
      WHERE c."id" = "cartId"
        AND (
          c."organizationId" = current_setting('app.current_org_id', TRUE)::UUID
          OR current_user = 'postgres'
        )
    )
  );

DROP POLICY IF EXISTS "PharmacyCartItem_tenant_insert" ON public."PharmacyCartItem";
CREATE POLICY "PharmacyCartItem_tenant_insert"
  ON public."PharmacyCartItem" FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public."PharmacyCart" c
      WHERE c."id" = "cartId"
        AND c."organizationId" = current_setting('app.current_org_id', TRUE)::UUID
    )
  );

DROP POLICY IF EXISTS "PharmacyCartItem_tenant_delete" ON public."PharmacyCartItem";
CREATE POLICY "PharmacyCartItem_tenant_delete"
  ON public."PharmacyCartItem" FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public."PharmacyCart" c
      WHERE c."id" = "cartId"
        AND c."organizationId" = current_setting('app.current_org_id', TRUE)::UUID
    )
  );

-- ---------------------------------------------------------------------------
-- Grants al rol authenticated (usado por withTenantContext)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON public."PharmacyCart"     TO authenticated;
GRANT SELECT, INSERT, DELETE  ON public."PharmacyCartItem" TO authenticated;
