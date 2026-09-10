-- 228 — Lista de precios DEFAULT de la organización
-- APLICADO a prod 2026-09-10 vía MCP — NO re-aplicar.
--
-- Decisión de Edwin (2026-09-10): la lista por defecto del complejo es
-- "Precios Avante Complejo Hospitalario". El resolver de precios
-- (packages/trpc/src/lib/price-resolver.ts) la evalúa cuando la cuenta no
-- tiene lista asignada vía TipoCuenta, o cuando la asignada no produce precio
-- para el código — ANTES de caer a LabTest.standardPrice / PENDIENTE_TARIFA.

BEGIN;

ALTER TABLE "ServicePriceList" ADD COLUMN IF NOT EXISTS "isDefault" boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN "ServicePriceList"."isDefault" IS 'Lista por defecto de la organización: el resolver de precios cae a ella cuando la cuenta no tiene lista asignada o la asignada no produce precio para el código (decisión Edwin 2026-09-10). Única por org (índice parcial).';

CREATE UNIQUE INDEX IF NOT EXISTS "ServicePriceList_org_default_key"
  ON "ServicePriceList" ("organizationId") WHERE "isDefault";

-- "ODOO — Precios Avante Complejo Hospitalario" de la org operativa
-- (INVERSIONES AVANTE, S.A. DE C.V. — ver SQL 227).
UPDATE "ServicePriceList" SET "isDefault" = true, "updatedAt" = now()
WHERE id = '693a8f5a-e255-4130-a470-d24470df41f9';

COMMIT;

-- Verificación:
--   SELECT name, "isDefault" FROM "ServicePriceList" WHERE "isDefault";
--   -- → 1 fila: ODOO — Precios Avante Complejo Hospitalario
