-- =============================================================================
-- 191_cc0015_tipo_cuenta_listas_precios.sql
-- CC-0015 — Tipo de cuenta del paciente → lista de precios (pivote de cargos)
--
-- Propósito:
--   a) Fix drift: ServicePriceListItem no tenía "updatedAt" en BD aunque el
--      router (SQL 133 / service-price-list.router.ts) ya lo selecciona/escribe.
--   b) Unique idempotente (priceListId, code) para que el seed de tarifario
--      Odoo (packages/database/scripts/seed-tarifario-odoo.mjs) pueda hacer
--      upsert ON CONFLICT. Los items legacy con code NULL (17 items demo de
--      SQL 133) no participan del constraint (WHERE code IS NOT NULL) — no se
--      tocan, no colisionan.
--   c) Tabla TipoCuenta: catálogo de pivotes de cobro por org (PARTICULAR +
--      un tipo por pagador). Vincula opcionalmente a ServicePriceList y a
--      Insurer.
--   d) PatientAccount.tipoCuentaId — la cuenta queda anclada a su tipo desde
--      la creación (define qué lista de precios aplica a sus cargos).
--   e) Invoice.patientAccountId — ancla los cargos facturados a la cuenta de
--      origen (hoy Invoice solo se ancla a patientId/encounterId).
--   f) Seed de TipoCuenta por organización real (excluye 'RLS-Test%'):
--      PARTICULAR + 15 tipos-pagador. priceListId se deja NULL aquí — lo
--      enlaza el seed script de tarifario Odoo una vez que las
--      ServicePriceList existen (upsert por nombre "ODOO — {lista}").
--
-- Idempotente: reejecutable sin duplicar filas ni perder datos.
-- Aplicar vía: Supabase SQL Editor o MCP execute_sql / apply_migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) Drift fix — ServicePriceListItem."updatedAt"
-- -----------------------------------------------------------------------------
ALTER TABLE public."ServicePriceListItem"
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now();

-- -----------------------------------------------------------------------------
-- b) Unique idempotente para upsert del seed de tarifario Odoo.
--    Items legacy con code NULL (demo SQL 133) quedan fuera del constraint
--    a propósito — no son candidatos a upsert por code.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_spl_item_list_code
  ON public."ServicePriceListItem" ("priceListId", code)
  WHERE code IS NOT NULL;

-- -----------------------------------------------------------------------------
-- c) Tabla TipoCuenta
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."TipoCuenta" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid        NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  code             varchar(30) NOT NULL,
  nombre           varchar(120) NOT NULL,
  "priceListId"    uuid        REFERENCES public."ServicePriceList"(id) ON DELETE SET NULL,
  "insurerId"      uuid        REFERENCES public."Insurer"(id) ON DELETE SET NULL,
  "esParticular"   boolean     NOT NULL DEFAULT false,
  active           boolean     NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "createdBy"      uuid,
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedBy"      uuid,
  CONSTRAINT uq_tipo_cuenta_org_code UNIQUE ("organizationId", code)
);

COMMENT ON TABLE public."TipoCuenta" IS
  'CC-0015 — Pivote de cobro de la cuenta del paciente. Determina qué ServicePriceList aplica a los cargos de la cuenta (fallback: LabTest.standardPrice).';
COMMENT ON COLUMN public."TipoCuenta"."priceListId" IS
  'Lista de precios asignada. NULL = sin lista asociada (cae al fallback standardPrice o precio manual).';
COMMENT ON COLUMN public."TipoCuenta"."insurerId" IS
  'Aseguradora asociada (opcional). No se auto-vincula en el seed — el catálogo Insurer no tenía filas para estos pagadores al momento de CC-0015.';
COMMENT ON COLUMN public."TipoCuenta"."esParticular" IS
  'true = tipo PARTICULAR (paciente paga directo, sin aseguradora).';

CREATE INDEX IF NOT EXISTS idx_tipo_cuenta_org ON public."TipoCuenta" ("organizationId", active);
CREATE INDEX IF NOT EXISTS idx_tipo_cuenta_price_list ON public."TipoCuenta" ("priceListId") WHERE "priceListId" IS NOT NULL;

ALTER TABLE public."TipoCuenta" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tipo_cuenta_tenant ON public."TipoCuenta";
CREATE POLICY tipo_cuenta_tenant ON public."TipoCuenta"
  FOR ALL TO authenticated
  USING (
    "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public."TipoCuenta" TO authenticated;

-- -----------------------------------------------------------------------------
-- d) PatientAccount.tipoCuentaId
-- -----------------------------------------------------------------------------
ALTER TABLE public."PatientAccount"
  ADD COLUMN IF NOT EXISTS "tipoCuentaId" uuid REFERENCES public."TipoCuenta"(id);

CREATE INDEX IF NOT EXISTS idx_patient_account_tipo_cuenta
  ON public."PatientAccount" ("tipoCuentaId")
  WHERE "tipoCuentaId" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- e) Invoice.patientAccountId — ancla los cargos a la cuenta de origen.
-- -----------------------------------------------------------------------------
ALTER TABLE public."Invoice"
  ADD COLUMN IF NOT EXISTS "patientAccountId" uuid REFERENCES public."PatientAccount"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_patient_account
  ON public."Invoice" ("patientAccountId")
  WHERE "patientAccountId" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- f) Seed de TipoCuenta por organización real (excluye orgs de prueba RLS).
--    priceListId queda NULL — lo enlaza seed-tarifario-odoo.mjs tras crear
--    las ServicePriceList "ODOO — {nombre lista}".
-- -----------------------------------------------------------------------------
INSERT INTO public."TipoCuenta" ("organizationId", code, nombre, "esParticular", active)
SELECT o.id, v.code, v.nombre, v."esParticular", true
FROM public."Organization" o
CROSS JOIN (VALUES
  ('PARTICULAR',    'Particular',              true),
  ('ISBM',          'ISBM',                    false),
  ('MAPFRE',        'Mapfre Seguros',          false),
  ('ABANK',         'Aseguradora Abank',       false),
  ('ASESUISA',      'Asesuisa Vida',           false),
  ('SISA_VIDA',     'Sisa Vida',               false),
  ('CIGNA',         'Cigna Healthcare',        false),
  ('PALIC',         'Pan American Life',       false),
  ('DAVIVIENDA',    'Davivienda',              false),
  ('CEL',           'CEL',                     false),
  ('MEDIPROCESOS',  'Mediprocesos',            false),
  ('AGRICOLA',      'Aseguradora Agrícola',    false),
  ('ASSA',          'ASSA',                    false),
  ('ENLACES',       'Enlaces El Salvador',     false),
  ('DRSV',          'DRSV',                    false),
  ('DRSV_IMG',      'DRSV Imágenes',           false)
) AS v(code, nombre, "esParticular")
WHERE o."legalName" NOT LIKE 'RLS-Test%'
  AND NOT EXISTS (
    SELECT 1 FROM public."TipoCuenta" tc
    WHERE tc."organizationId" = o.id AND tc.code = v.code
  );

-- -----------------------------------------------------------------------------
-- Verificación (ejecutar manualmente tras aplicar):
-- -----------------------------------------------------------------------------
-- SELECT o."legalName", count(*) FROM public."TipoCuenta" tc
--   JOIN public."Organization" o ON o.id = tc."organizationId"
--   GROUP BY o."legalName" ORDER BY 1;
-- -- Debe dar 16 tipos por cada org real (PARTICULAR + 15 pagadores).
