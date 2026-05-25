-- =============================================================================
-- 128_cost_center_table_and_invoice_fk.sql
-- Wave 3.1 — Centro de costo obligatorio en facturación.
--
-- Motivación: sin asignación firme de centro de costo no es posible verificar
-- presupuesto ni hacer análisis de margen por área. Este fix saca a Invoice/
-- InvoiceItem del estado "costCenterId nullable sin FK" en que quedaron tras
-- 127_finance_invoice_claim.sql (debt by design para no bloquear el merge MVP).
--
-- Cambios:
--   1. Crea tabla `CostCenter` (existía en schema.prisma pero no en BD).
--   2. Seed: 1 CostCenter "GEN" general por cada Organization existente.
--   3. InvoiceItem.costCenterId → NOT NULL + FK RESTRICT.
--   4. Invoice.costCenterId (cabecera, nullable inicialmente) + FK.
--
-- Aplicado a prod 2026-05-25 vía MCP
-- (migration: cost_center_table_and_invoice_fk_2026_05_25).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "CostCenter" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT,
  code             varchar(20) NOT NULL,
  name             varchar(120) NOT NULL,
  "parentId"       uuid REFERENCES "CostCenter"(id),
  active           boolean NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organizationId", code)
);

CREATE INDEX IF NOT EXISTS idx_cost_center_org_active ON "CostCenter" ("organizationId", active);

ALTER TABLE "CostCenter" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_center_tenant ON "CostCenter";
CREATE POLICY cost_center_tenant ON "CostCenter"
  FOR ALL TO authenticated
  USING ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

INSERT INTO "CostCenter" ("organizationId", code, name)
SELECT o.id, 'GEN', 'Centro de Costo General'
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "CostCenter" cc
  WHERE cc."organizationId" = o.id AND cc.code = 'GEN'
);

-- InvoiceItem.costCenterId obligatorio
ALTER TABLE "InvoiceItem"
  ALTER COLUMN "costCenterId" SET NOT NULL,
  ADD CONSTRAINT invoice_item_cost_center_fkey
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"(id) ON DELETE RESTRICT;

-- Invoice gana costCenterId opcional en cabecera (presupuesto agregado por área)
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "costCenterId" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='Invoice' AND constraint_name='invoice_cost_center_fkey'
  ) THEN
    ALTER TABLE "Invoice"
      ADD CONSTRAINT invoice_cost_center_fkey
        FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_cost_center ON "Invoice" ("costCenterId") WHERE "costCenterId" IS NOT NULL;
