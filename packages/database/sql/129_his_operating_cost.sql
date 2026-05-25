-- =============================================================================
-- 129_his_operating_cost.sql
-- Wave 6 — Módulo costos operativos del HIS.
--
-- Habilita el KPI fin_costo_his del dashboard ejecutivo. Modelo simple:
--   - cada fila = un costo periódico (típicamente mensual)
--   - organizationId nullable: NULL = compartido entre todas las orgs activas
--   - period_start/end definen ventana de aplicación (prorrateable)
--   - category: SUBSCRIPTION | INFRASTRUCTURE | SUPPORT | LICENSE | OTHER
--
-- Aplicado a prod 2026-05-25 vía MCP (migration: his_operating_cost_2026_05_25).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE his_cost_category AS ENUM (
    'SUBSCRIPTION', 'INFRASTRUCTURE', 'SUPPORT', 'LICENSE', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "HisOperatingCost" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid REFERENCES "Organization"(id) ON DELETE RESTRICT,
  category         his_cost_category NOT NULL,
  description      varchar(200) NOT NULL,
  vendor           varchar(120),
  amount           numeric(14,2) NOT NULL,
  "currencyId"     uuid NOT NULL REFERENCES "Currency"(id) ON DELETE RESTRICT,
  "periodStart"    date NOT NULL,
  "periodEnd"      date NOT NULL,
  notes            text,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "createdBy"      uuid,
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedBy"      uuid,
  CONSTRAINT his_cost_period_chk CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT his_cost_amount_chk CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_his_cost_period
  ON "HisOperatingCost" ("periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS idx_his_cost_org
  ON "HisOperatingCost" ("organizationId") WHERE "organizationId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_his_cost_category
  ON "HisOperatingCost" (category);

ALTER TABLE "HisOperatingCost" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS his_cost_tenant_isolation ON "HisOperatingCost";
CREATE POLICY his_cost_tenant_isolation ON "HisOperatingCost"
  FOR ALL TO authenticated
  USING (
    "organizationId" IS NULL
    OR "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" IS NULL
    OR "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
  );

-- Seed demo: costos típicos del stack HIS (mensual, compartidos).
INSERT INTO "HisOperatingCost"
  (category, description, vendor, amount, "currencyId", "periodStart", "periodEnd")
SELECT * FROM (VALUES
  ('SUBSCRIPTION'::his_cost_category, 'Vercel Pro - hosting + builds + edge functions', 'Vercel',
   300.00, (SELECT id FROM "Currency" WHERE "isoCode"='USD'), DATE '2026-05-01', DATE '2026-05-31'),
  ('SUBSCRIPTION'::his_cost_category, 'Supabase Pro - Postgres + Auth + Storage', 'Supabase',
   500.00, (SELECT id FROM "Currency" WHERE "isoCode"='USD'), DATE '2026-05-01', DATE '2026-05-31'),
  ('SUBSCRIPTION'::his_cost_category, 'GitHub Pro - repo + Actions', 'GitHub',
   40.00, (SELECT id FROM "Currency" WHERE "isoCode"='USD'), DATE '2026-05-01', DATE '2026-05-31'),
  ('SUPPORT'::his_cost_category, 'Equipo TI / DevOps interno (estimado mensual)', 'Inversiones Avante - Unidad TD',
   3500.00, (SELECT id FROM "Currency" WHERE "isoCode"='USD'), DATE '2026-05-01', DATE '2026-05-31'),
  ('LICENSE'::his_cost_category, 'Resend - email transaccional', 'Resend',
   20.00, (SELECT id FROM "Currency" WHERE "isoCode"='USD'), DATE '2026-05-01', DATE '2026-05-31'),
  ('INFRASTRUCTURE'::his_cost_category, 'Backups + Disaster Recovery (estimado)', 'Inversiones Avante - Unidad TD',
   150.00, (SELECT id FROM "Currency" WHERE "isoCode"='USD'), DATE '2026-05-01', DATE '2026-05-31')
) AS s(category, description, vendor, amount, "currencyId", "periodStart", "periodEnd")
WHERE NOT EXISTS (
  SELECT 1 FROM "HisOperatingCost" WHERE description = s.description AND "periodStart" = s."periodStart"
);
