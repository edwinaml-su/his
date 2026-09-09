-- =============================================================================
-- 224_cargos_integridad.sql
-- docs/48 Ola 1 (Integridad) — RN-HIS-BOT-001 (docs/47 + docs/qa/drhis/…verificacion).
--
-- Cierra, ANTES del primer cargo real, las brechas de esquema/auditoría que el
-- dictamen @DrHIS encontró en el circuito de cobro (H-02/H-04/H-05/H-08/H-09):
--   a) Columnas de congelamiento de precio (PatientAccountService/InvoiceItem)
--      y de estado de cuenta (PatientAccount) — espejo de schema.prisma.
--   b) Hash-chain de auditoría (patrón `trg_audit_<Tabla>` de 02_audit_triggers.sql,
--      encadenado por `trg_auditlog_chain` de 05_audit_hash_chain.sql — NO se
--      crea una función nueva, se reutiliza `audit.fn_audit_row()` SECURITY
--      DEFINER, que ya inserta en audit."AuditLog" pase lo que pase con los
--      grants de `authenticated` sobre esa tabla, ver 206_audit_write_path.sql)
--      sobre las 9 tablas financieras: Invoice, InvoiceItem, InvoicePayment,
--      PatientAccount, PatientAccountService, TipoCuenta, ServicePriceList,
--      ServicePriceListItem, ServicePriceRule.
--   c) Candado de `PatientAccount.tipoCuentaId`: migra la única fila NULL de
--      prod (asignándole el TipoCuenta PARTICULAR de su organización) y agrega
--      un trigger BEFORE INSERT que exige la columna en filas NUEVAS — sin
--      ALTER COLUMN SET NOT NULL directo, para no reventar si el UPDATE no
--      encontrara un PARTICULAR en alguna organización.
--   d) Backfill de vigencia: `ServicePriceRule.dateStart` = `createdAt` en las
--      reglas que no la tienen (987 de 999 en prod al momento de este SQL).
--
-- e) RLS: las 9 tablas YA tienen policy de tenant (verificado en el repo antes
--    de escribir este archivo, no se re-crea ninguna):
--      Invoice/InvoiceItem/InvoicePayment  → sql/127_finance_invoice_claim.sql
--      PatientAccount/PatientAccountService → sql/178_cc0002_cuenta_servicio.sql
--      TipoCuenta                           → sql/191_cc0015_tipo_cuenta_listas_precios.sql
--      ServicePriceList/ServicePriceListItem→ sql/133_service_price_list_tarifario.sql
--      ServicePriceRule                     → sql/204_cc0021_motor_reglas_precios.sql
--    Las columnas/enums nuevos de este archivo no cambian ningún predicado de
--    esas policies (todas filtran por organizationId directo o vía join a la
--    fila dueña) — ninguna policy se toca aquí.
--
-- Todo lo de abajo es idempotente (ADD COLUMN IF NOT EXISTS, DO $$ guards para
-- tipos/triggers, UPDATE con WHERE acotado). APLICADO a prod 2026-09-09 vía MCP
-- (migración cargos_integridad_224) y verificado: 9 triggers, 0 cuentas sin
-- tipo, 0 reglas sin vigencia. NO re-aplicar.
--
-- Fuera de alcance de este archivo (Ola 2 en adelante, docs/48 §4): ningún
-- acto clínico escribe todavía en PatientAccountService/InvoiceItem — las
-- columnas nuevas quedan NULL hasta que exista `capturarCargo` (C2-1/C2-2) y
-- `invoice.create` re-resuelva precio server-side (C2-3).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) Enums + columnas nuevas (espejo de schema.prisma).
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'AccountStatus' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public."AccountStatus" AS ENUM ('ABIERTA', 'PENDIENTE_REGULARIZAR', 'CERRADA');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ChargeStatus' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public."ChargeStatus" AS ENUM ('VIGENTE', 'PENDIENTE_TARIFA', 'REVERTIDO', 'REVERSION');
  END IF;
END $$;

-- PatientAccount — estado administrativo (C1-5).
ALTER TABLE public."PatientAccount"
  ADD COLUMN IF NOT EXISTS "status"   public."AccountStatus" NOT NULL DEFAULT 'ABIERTA',
  ADD COLUMN IF NOT EXISTS "closedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "closedBy" uuid;

COMMENT ON COLUMN public."PatientAccount"."status" IS
  'docs/48 Ola 1 (C1-5) — PENDIENTE_REGULARIZAR: emergencia abierta sin pagador (RN-HIS-BOT-001 R1). Bloqueo real de cierre en Ola 4 (C4-1).';

-- PatientAccountService — línea de cargo canónica (C1-2/C1-1). Nullable a
-- propósito: la captura real (Ola 2) todavía no escribe aquí.
ALTER TABLE public."PatientAccountService"
  ADD COLUMN IF NOT EXISTS "code"         varchar(40),
  ADD COLUMN IF NOT EXISTS "quantity"     numeric(12,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "unitPrice"    numeric(12,2),
  ADD COLUMN IF NOT EXISTS "totalPrice"   numeric(12,2),
  ADD COLUMN IF NOT EXISTS "priceListId"  uuid,
  ADD COLUMN IF NOT EXISTS "priceRuleId"  uuid,
  ADD COLUMN IF NOT EXISTS "resolvedAt"   timestamptz,
  ADD COLUMN IF NOT EXISTS "priceSource"  varchar(20),
  ADD COLUMN IF NOT EXISTS "status"       public."ChargeStatus" NOT NULL DEFAULT 'VIGENTE',
  ADD COLUMN IF NOT EXISTS "reversalOfId" uuid REFERENCES public."PatientAccountService"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "origen"       varchar(30),
  ADD COLUMN IF NOT EXISTS "referenciaId" uuid,
  ADD COLUMN IF NOT EXISTS "updatedAt"    timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE public."PatientAccountService"
    ADD CONSTRAINT patient_account_service_price_source_chk
    CHECK ("priceSource" IS NULL OR "priceSource" IN ('regla', 'lista', 'standard', 'manual_override'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_patient_account_service_reversal
  ON public."PatientAccountService" ("reversalOfId") WHERE "reversalOfId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_account_service_status
  ON public."PatientAccountService" ("accountId", "status");

COMMENT ON COLUMN public."PatientAccountService"."priceSource" IS
  'regla | lista | standard | manual_override. NOTA Ola 2: price-resolver.ts hoy devuelve "estandar" (ES) — mapear a "standard" al cablear capturarCargo (C2-1).';
COMMENT ON COLUMN public."PatientAccountService"."reversalOfId" IS
  'Self-FK: la fila REVERSION apunta al cargo VIGENTE/REVERTIDO que anula. El original nunca se borra (docs/48 C2-4).';

-- InvoiceItem — congelamiento de tarifa demostrable (C1-2/H-05).
ALTER TABLE public."InvoiceItem"
  ADD COLUMN IF NOT EXISTS "priceListId" uuid,
  ADD COLUMN IF NOT EXISTS "priceRuleId" uuid,
  ADD COLUMN IF NOT EXISTS "resolvedAt"  timestamptz,
  ADD COLUMN IF NOT EXISTS "priceSource" varchar(20),
  ADD COLUMN IF NOT EXISTS "updatedAt"   timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE public."InvoiceItem"
    ADD CONSTRAINT invoice_item_price_source_chk
    CHECK ("priceSource" IS NULL OR "priceSource" IN ('regla', 'lista', 'standard', 'manual_override'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public."InvoiceItem"."priceSource" IS
  'regla | lista | standard | manual_override. Nullable hasta que invoice.create re-resuelva server-side (Ola 2, C2-3).';

-- -----------------------------------------------------------------------------
-- b) Hash-chain de auditoría — mismo patrón que 02_audit_triggers.sql §3.
--    audit.fn_audit_row() es SECURITY DEFINER: inserta en audit."AuditLog"
--    con el rol propietario, no con `authenticated` — el INSERT real dispara
--    `trg_auditlog_chain` (05_audit_hash_chain.sql) que encadena prevHash/
--    signatureHash igual que para cualquier otra tabla auditada.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  financieras text[] := ARRAY[
    'Invoice', 'InvoiceItem', 'InvoicePayment',
    'PatientAccount', 'PatientAccountService', 'TipoCuenta',
    'ServicePriceList', 'ServicePriceListItem', 'ServicePriceRule'
  ];
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
-- c) Candado de PatientAccount.tipoCuentaId (H-09).
--    c.1 — migra la fila histórica NULL: le asigna el TipoCuenta marcado
--          esParticular=true de su propia organización, si existe.
--    c.2 — trigger BEFORE INSERT: exige la columna en filas NUEVAS. No se
--          hace ALTER COLUMN SET NOT NULL directo — si alguna organización
--          no tuviera un TipoCuenta particular, el UPDATE no la resuelve y
--          un NOT NULL directo tumbaría el ALTER; el trigger sí deja pasar
--          filas históricas y solo bloquea inserciones nuevas sin tipo.
-- -----------------------------------------------------------------------------

UPDATE public."PatientAccount" pa
   SET "tipoCuentaId" = tc.id
  FROM public."TipoCuenta" tc
 WHERE pa."tipoCuentaId" IS NULL
   AND tc."organizationId" = pa."organizationId"
   AND tc."esParticular" = true
   AND tc.active = true;

CREATE OR REPLACE FUNCTION public.fn_patient_account_require_tipo_cuenta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW."tipoCuentaId" IS NULL THEN
    RAISE EXCEPTION 'PatientAccount: tipoCuentaId es obligatorio en cuentas nuevas (docs/48 C1-3/H-09)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patient_account_require_tipo_cuenta ON public."PatientAccount";
CREATE TRIGGER trg_patient_account_require_tipo_cuenta
  BEFORE INSERT ON public."PatientAccount"
  FOR EACH ROW EXECUTE FUNCTION public.fn_patient_account_require_tipo_cuenta();

-- -----------------------------------------------------------------------------
-- d) Backfill de vigencia — ServicePriceRule.dateStart (H-04).
--    createdAt es NOT NULL en la tabla (sql/204) — siempre hay un valor.
-- -----------------------------------------------------------------------------

UPDATE public."ServicePriceRule"
   SET "dateStart" = "createdAt"
 WHERE "dateStart" IS NULL;

-- =============================================================================
-- Verificación manual post-apply:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = ANY (ARRAY['"Invoice"','"InvoiceItem"','"InvoicePayment"',
--      '"PatientAccount"','"PatientAccountService"','"TipoCuenta"',
--      '"ServicePriceList"','"ServicePriceListItem"','"ServicePriceRule"']::regclass[])
--      AND tgname LIKE 'trg_audit_%';                     -- esperado: 9 filas
--   SELECT count(*) FROM "PatientAccount" WHERE "tipoCuentaId" IS NULL;  -- esperado: 0
--   SELECT count(*) FROM "ServicePriceRule" WHERE "dateStart" IS NULL;   -- esperado: 0
--   INSERT INTO "PatientAccount" (id, "organizationId", "patientId", "numeroCuenta")
--     VALUES (gen_random_uuid(), '<org>', '<paciente>', 'CTA99999');    -- debe fallar (trigger)
-- =============================================================================
