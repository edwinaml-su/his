-- =============================================================================
-- 133_service_price_list_tarifario.sql
-- Wave 11 — Tarifario / Catálogo de servicios facturables.
-- Permite reusar items en Invoice sin digitar descripción/precio cada vez.
-- Cada item sugiere `costCenterId` automáticamente al insertarse en una factura.
-- Aplicado a prod 2026-05-25 vía MCP (service_price_list_tarifario_2026_05_25).
-- Seed: 1 tarifario "Estándar 2026" + 17 items demo para Hospital Avante.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "ServicePriceList" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT,
  name             varchar(120) NOT NULL,
  "currencyId"     uuid NOT NULL REFERENCES "Currency"(id) ON DELETE RESTRICT,
  "validFrom"      date NOT NULL DEFAULT CURRENT_DATE,
  "validTo"        date,
  active           boolean NOT NULL DEFAULT true,
  notes            text,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "createdBy"      uuid,
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedBy"      uuid,
  UNIQUE ("organizationId", name)
);

CREATE INDEX IF NOT EXISTS idx_service_price_list_org ON "ServicePriceList" ("organizationId", active);

ALTER TABLE "ServicePriceList" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_price_list_tenant ON "ServicePriceList";
CREATE POLICY service_price_list_tenant ON "ServicePriceList"
  FOR ALL TO authenticated
  USING ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS "ServicePriceListItem" (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "priceListId"           uuid NOT NULL REFERENCES "ServicePriceList"(id) ON DELETE CASCADE,
  code                    varchar(40),
  description             varchar(300) NOT NULL,
  "unitPrice"             numeric(14,2) NOT NULL,
  "estimatedCost"         numeric(14,2),
  "serviceUnitId"         uuid REFERENCES "ServiceUnit"(id) ON DELETE SET NULL,
  "suggestedCostCenterId" uuid REFERENCES "CostCenter"(id) ON DELETE SET NULL,
  active                  boolean NOT NULL DEFAULT true,
  "createdAt"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spl_item_amount_chk CHECK ("unitPrice" >= 0)
);

CREATE INDEX IF NOT EXISTS idx_spl_item_list  ON "ServicePriceListItem" ("priceListId", active);
CREATE INDEX IF NOT EXISTS idx_spl_item_code  ON "ServicePriceListItem" (code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spl_item_cc    ON "ServicePriceListItem" ("suggestedCostCenterId") WHERE "suggestedCostCenterId" IS NOT NULL;

ALTER TABLE "ServicePriceListItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spl_item_tenant ON "ServicePriceListItem";
CREATE POLICY spl_item_tenant ON "ServicePriceListItem"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "ServicePriceList" spl WHERE spl.id = "ServicePriceListItem"."priceListId"
                 AND spl."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "ServicePriceList" spl WHERE spl.id = "ServicePriceListItem"."priceListId"
                 AND spl."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid));

-- Seed: ver bloque DO en migración prod. 17 items cubriendo consulta, emergencia,
-- hospitalización, UCI, quirúrgico, laboratorio, imagen y farmacia.
