-- =============================================================================
-- 231_room_bed_odoo_mirror.sql — Modelo de habitaciones (Room) espejo de
-- Odoo ACS HMS (hospital.ward + hospital.bed + custom camas.config).
-- APLICADO a prod 2026-09-11 vía MCP — NO re-aplicar.
--
-- Encargo de Edwin 2026-09-11: hasta hoy `Bed.room` era texto libre sin
-- entidad propia. Odoo modela la habitación (`hospital.ward`) con amenidades,
-- política de género, tipo y facturación por estancia; `hospital.bed` agrega
-- tipo de cama y `camas.config` (custom) agrega clase de facturación
-- (GENERAL/ISBM). Este archivo:
--   1) Crea `public."Room"` (espejo hospital.ward).
--   2) Extiende `public."Bed"` con roomId/bedType/billingClass (espejo
--      hospital.bed + camas.config). `Bed.status` YA tenía BLOCKED y
--      MAINTENANCE (BedStatus, schema.prisma) — no hace falta ALTER TYPE,
--      a diferencia de lo anticipado en el encargo original.
--   3) Migra las 72 camas reales de prod (sql/229) a 1 Room por cama
--      (code=Bed.code, name=Bed.room, mismo establishment/serviceUnit,
--      glnCodigo=el de la cama) y enlaza Bed.roomId. Las 66 camas seed
--      ficticias (active=false, glnCodigo NULL, sql/229 paso 6) NO migran.
--
-- RLS + audit: mismo patrón que Bed/ServiceUnit (tenant_isolation_select/
-- modify vía public.current_org_id()/is_break_glass(), trg_audit_<Tabla> vía
-- audit.fn_audit_row() — verificado en prod, sql/01_rls_policies.sql +
-- sql/02_audit_triggers.sql). Room NO lleva trigger set_updated_at: ni Bed
-- ni ServiceUnit ni Establishment lo tienen en prod (updatedAt se mantiene a
-- nivel Prisma `@updatedAt`, no en BD) — se mantiene consistencia con esas
-- tres tablas vecinas.
--
-- Lección 30a/30b, 212: CREATE INDEX va ANTES del INSERT/UPDATE sobre la
-- misma tabla en esta transacción (triggers de auditoría dejan pending
-- trigger events). Orden respetado abajo.
--
-- Idempotente. Aplicar vía mcp apply_migration en una sola transacción.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Tabla Room (espejo hospital.ward)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."Room" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"  uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "establishmentId" uuid NOT NULL REFERENCES public."Establishment"(id) ON DELETE CASCADE,
  "serviceUnitId"   uuid NOT NULL REFERENCES public."ServiceUnit"(id) ON DELETE RESTRICT,
  code              varchar(40)  NOT NULL,
  name              varchar(120) NOT NULL,
  floor             varchar(10),
  "roomType"        varchar(20)  NOT NULL DEFAULT 'GENERAL'
    CONSTRAINT chk_room_room_type CHECK ("roomType" IN (
      'GENERAL','SEMI_ESPECIAL','DELUXE','SUPER_DELUXE','SUITE','COMPARTIDA',
      'UCI','DIALISIS','RECUPERACION'
    )),
  "genderPolicy"    varchar(10)  NOT NULL DEFAULT 'UNISEX'
    CONSTRAINT chk_room_gender_policy CHECK ("genderPolicy" IN ('HOMBRES','MUJERES','UNISEX')),
  private           boolean NOT NULL DEFAULT false,
  "bioHazard"       boolean NOT NULL DEFAULT false,
  "airConditioning" boolean NOT NULL DEFAULT false,
  television        boolean NOT NULL DEFAULT false,
  telephone         boolean NOT NULL DEFAULT false,
  "privateBathroom" boolean NOT NULL DEFAULT false,
  internet          boolean NOT NULL DEFAULT false,
  refrigerator      boolean NOT NULL DEFAULT false,
  microwave         boolean NOT NULL DEFAULT false,
  "guestSofa"       boolean NOT NULL DEFAULT false,
  "chargeCode"      varchar(40),
  "invoicePolicy"   varchar(10) NOT NULL DEFAULT 'DIA'
    CONSTRAINT chk_room_invoice_policy CHECK ("invoicePolicy" IN ('DIA','HORA')),
  "glnCodigo"       varchar(13)
    CONSTRAINT fk_room_gln REFERENCES ece.gs1_gln(codigo) DEFERRABLE INITIALLY DEFERRED,
  notes             text,
  active            boolean NOT NULL DEFAULT true,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "createdBy"       uuid,
  "updatedAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedBy"       uuid,
  CONSTRAINT "Room_establishmentId_code_key" UNIQUE ("establishmentId", code)
);

CREATE INDEX IF NOT EXISTS idx_room_organization   ON public."Room" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_room_establishment   ON public."Room" ("establishmentId");
CREATE INDEX IF NOT EXISTS idx_room_service_unit    ON public."Room" ("serviceUnitId");
CREATE INDEX IF NOT EXISTS idx_room_gln             ON public."Room" ("glnCodigo") WHERE "glnCodigo" IS NOT NULL;

COMMENT ON TABLE public."Room" IS
  'Habitación — espejo de hospital.ward (Odoo ACS HMS). sql/231, encargo Edwin 2026-09-11.';

-- -----------------------------------------------------------------------------
-- 2. Extiende Bed (espejo hospital.bed + custom camas.config)
-- -----------------------------------------------------------------------------
ALTER TABLE public."Bed"
  ADD COLUMN IF NOT EXISTS "roomId" uuid REFERENCES public."Room"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "bedType" varchar(20),
  ADD COLUMN IF NOT EXISTS "billingClass" varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bed_bed_type') THEN
    ALTER TABLE public."Bed"
      ADD CONSTRAINT chk_bed_bed_type CHECK (
        "bedType" IS NULL OR "bedType" IN (
          'GATCH','ELECTRICA','CAMILLA','BAJA','BAJA_PERDIDA_AIRE',
          'CIRCO_ELECTRICA','CLINITRON'
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bed_billing_class') THEN
    ALTER TABLE public."Bed"
      ADD CONSTRAINT chk_bed_billing_class CHECK (
        "billingClass" IS NULL OR "billingClass" IN ('GENERAL','ISBM')
      );
  END IF;
END $$;

COMMENT ON COLUMN public."Bed"."room" IS
  'DEPRECADO — nombre de habitación en texto libre. Reemplazado por roomId '
  '(modelo Room, sql/231). Se conserva por compatibilidad histórica.';
COMMENT ON COLUMN public."Bed"."roomId" IS
  'FK a Room (sql/231) — espejo hospital.bed.ward_id de Odoo. Nullable '
  'durante la transición desde el campo texto `room`.';
COMMENT ON COLUMN public."Bed"."bedType" IS
  'Tipo de cama — espejo hospital.bed (Odoo ACS HMS). Vocabulario cerrado '
  'por CHECK, no enum Postgres.';
COMMENT ON COLUMN public."Bed"."billingClass" IS
  'Clase de facturación — espejo custom camas.config (Odoo). Vocabulario '
  'cerrado por CHECK, no enum Postgres.';

CREATE INDEX IF NOT EXISTS idx_bed_room ON public."Bed" ("roomId") WHERE "roomId" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. RLS + grants + audit (mismo patrón que Bed/ServiceUnit/Establishment)
-- -----------------------------------------------------------------------------
ALTER TABLE public."Room" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."Room" TO authenticated;

DROP POLICY IF EXISTS tenant_isolation_select ON public."Room";
CREATE POLICY tenant_isolation_select ON public."Room"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS tenant_isolation_modify ON public."Room";
CREATE POLICY tenant_isolation_modify ON public."Room"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DROP TRIGGER IF EXISTS trg_audit_Room ON public."Room";
CREATE TRIGGER trg_audit_Room
  AFTER INSERT OR UPDATE OR DELETE ON public."Room"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- -----------------------------------------------------------------------------
-- 4. Migración de datos — 1 Room por cama real activa (sql/229). Las camas
--    seed ficticias (active=false, glnCodigo NULL) NO se migran.
-- -----------------------------------------------------------------------------
INSERT INTO public."Room" (
  id, "organizationId", "establishmentId", "serviceUnitId", code, name,
  "roomType", "glnCodigo", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), b."organizationId", b."establishmentId", b."serviceUnitId",
  b.code, b.room,
  CASE
    WHEN su.code = 'UCI' THEN 'UCI'
    WHEN su.code ILIKE '%RECUPERA%' OR su.name ILIKE '%recupera%' THEN 'RECUPERACION'
    ELSE 'GENERAL'
  END,
  b."glnCodigo", now(), now()
FROM public."Bed" b
JOIN public."ServiceUnit" su ON su.id = b."serviceUnitId"
WHERE b.active = true
  AND b."glnCodigo" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public."Room" r
    WHERE r."establishmentId" = b."establishmentId" AND r.code = b.code
  );

UPDATE public."Bed" b
SET "roomId" = r.id
FROM public."Room" r
WHERE r."establishmentId" = b."establishmentId"
  AND r.code = b.code
  AND b."roomId" IS NULL
  AND b.active = true
  AND b."glnCodigo" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. Verificación
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_rooms int;
  v_beds_linked int;
  v_beds_active_gln int;
BEGIN
  SELECT count(*) INTO v_rooms FROM public."Room";
  SELECT count(*) INTO v_beds_linked FROM public."Bed" WHERE "roomId" IS NOT NULL;
  SELECT count(*) INTO v_beds_active_gln FROM public."Bed" WHERE active = true AND "glnCodigo" IS NOT NULL;

  ASSERT v_rooms = v_beds_active_gln,
    format('ERROR: Room count (%) != camas activas con GLN (%)', v_rooms, v_beds_active_gln);
  ASSERT v_beds_linked = v_beds_active_gln,
    format('ERROR: camas enlazadas a Room (%) != camas activas con GLN (%)', v_beds_linked, v_beds_active_gln);

  RAISE NOTICE 'OK: % Room creadas, % camas enlazadas', v_rooms, v_beds_linked;
END $$;

COMMIT;
