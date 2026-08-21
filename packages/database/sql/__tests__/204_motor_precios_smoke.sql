-- =============================================================================
-- HIS SQL 204 — Smoke tests del motor de reglas de precios (CC-0021).
--
-- Verifica lo que los tests de vitest NO pueden cubrir: el ORDEN de evaluación
-- de las reglas, que vive en el ORDER BY de SQL_REGLA_CANDIDATA
-- (packages/trpc/src/lib/price-resolver.ts) y debe replicar el `_order` de
-- product.pricelist.item de Odoo:
--     applied_on, min_quantity desc, categ_id desc, id desc
--
-- Cómo correr (SQL Editor del Supabase Dashboard, role postgres):
--   1. Aplicar sql/204_cc0021_motor_reglas_precios.sql.
--   2. Pegar este archivo y ejecutar. Cada bloque imprime lo esperado.
--   3. Todo corre dentro de una transacción que termina en ROLLBACK: no deja
--      datos. Si algún SELECT no coincide con lo esperado, NO aplicar el
--      importador de Odoo hasta corregir.
-- =============================================================================

BEGIN;

-- Datos de trabajo: una org real cualquiera + una lista y una categoría propias.
CREATE TEMP TABLE _smoke AS
SELECT
  (SELECT id FROM "Organization" WHERE "legalName" NOT LIKE 'RLS-Test%' ORDER BY "createdAt" LIMIT 1) AS org_id,
  (SELECT id FROM "Currency" WHERE "isoCode" = 'USD' LIMIT 1) AS currency_id;

INSERT INTO "ServiceCategory" (id, "organizationId", code, nombre)
SELECT '00000000-0000-0000-0000-0000000c0de1', org_id, 'SMOKE_PADRE', 'Smoke padre' FROM _smoke;
INSERT INTO "ServiceCategory" (id, "organizationId", code, nombre, "parentId")
SELECT '00000000-0000-0000-0000-0000000c0de2', org_id, 'SMOKE_HIJA', 'Smoke hija',
       '00000000-0000-0000-0000-0000000c0de1' FROM _smoke;

INSERT INTO "ServicePriceList" (id, "organizationId", name, "currencyId")
SELECT '00000000-0000-0000-0000-0000000115a1', org_id, 'SMOKE — lista CC-0021', currency_id FROM _smoke;

INSERT INTO "ServicePriceListItem" ("priceListId", code, description, "unitPrice", "categoryId")
VALUES ('00000000-0000-0000-0000-0000000115a1', 'SMOKE-01', 'Ítem de smoke', 100.00,
        '00000000-0000-0000-0000-0000000c0de2');

-- Cuatro reglas que compiten por el mismo código.
INSERT INTO "ServicePriceRule"
  ("priceListId", "appliedOn", "itemCode", "categoryId", "minQuantity", "computePrice", "fixedPrice", notes)
VALUES
  ('00000000-0000-0000-0000-0000000115a1', 'global',   NULL,       NULL,                                     0,  'fixed', 10, 'global'),
  ('00000000-0000-0000-0000-0000000115a1', 'category', NULL,       '00000000-0000-0000-0000-0000000c0de1',   0,  'fixed', 20, 'categoria padre'),
  ('00000000-0000-0000-0000-0000000115a1', 'category', NULL,       '00000000-0000-0000-0000-0000000c0de2',   0,  'fixed', 30, 'categoria hija'),
  ('00000000-0000-0000-0000-0000000115a1', 'item',     'SMOKE-01', NULL,                                     0,  'fixed', 40, 'item'),
  ('00000000-0000-0000-0000-0000000115a1', 'item',     'SMOKE-01', NULL,                                     10, 'fixed', 50, 'item tramo 10');

-- ---------------------------------------------------------------------------
-- Smoke 1 — cantidad 1: gana la regla de ítem sin tramo (notes = 'item', 40.00).
-- Smoke 2 — cantidad 10: gana el tramo (notes = 'item tramo 10', 50.00).
-- Ambos usan el MISMO ORDER BY que el resolver.
-- ---------------------------------------------------------------------------
WITH RECURSIVE categoria_base AS (
  SELECT '00000000-0000-0000-0000-0000000c0de2'::uuid AS id
),
ancestro AS (
  SELECT sc.id, sc."parentId", 0 AS distancia
    FROM "ServiceCategory" sc JOIN categoria_base cb ON cb.id = sc.id
  UNION ALL
  SELECT p.id, p."parentId", a.distancia + 1
    FROM "ServiceCategory" p JOIN ancestro a ON a."parentId" = p.id
   WHERE a.distancia < 10
),
cantidades AS (SELECT 1::numeric AS qty UNION ALL SELECT 10::numeric)
SELECT q.qty AS cantidad,
       (SELECT r.notes
          FROM "ServicePriceRule" r
          LEFT JOIN ancestro a ON a.id = r."categoryId"
         WHERE r."priceListId" = '00000000-0000-0000-0000-0000000115a1'
           AND r.active = true
           AND r."minQuantity" <= q.qty
           AND (r."appliedOn" = 'item' AND r."itemCode" = 'SMOKE-01'
                OR r."appliedOn" = 'category' AND a.id IS NOT NULL
                OR r."appliedOn" = 'global')
         ORDER BY CASE r."appliedOn" WHEN 'item' THEN 0 WHEN 'category' THEN 1 ELSE 2 END,
                  r."minQuantity" DESC, COALESCE(a.distancia, 0), r.sequence DESC, r."createdAt" DESC
         LIMIT 1) AS regla_ganadora
  FROM cantidades q;
-- Esperado: (1, 'item') y (10, 'item tramo 10').

-- ---------------------------------------------------------------------------
-- Smoke 3 — sin reglas de ítem, gana la categoría MÁS ESPECÍFICA (la hija).
-- ---------------------------------------------------------------------------
DELETE FROM "ServicePriceRule"
 WHERE "priceListId" = '00000000-0000-0000-0000-0000000115a1' AND "appliedOn" = 'item';

WITH RECURSIVE categoria_base AS (
  SELECT '00000000-0000-0000-0000-0000000c0de2'::uuid AS id
),
ancestro AS (
  SELECT sc.id, sc."parentId", 0 AS distancia
    FROM "ServiceCategory" sc JOIN categoria_base cb ON cb.id = sc.id
  UNION ALL
  SELECT p.id, p."parentId", a.distancia + 1
    FROM "ServiceCategory" p JOIN ancestro a ON a."parentId" = p.id
   WHERE a.distancia < 10
)
SELECT r.notes AS regla_ganadora, r."fixedPrice"
  FROM "ServicePriceRule" r
  LEFT JOIN ancestro a ON a.id = r."categoryId"
 WHERE r."priceListId" = '00000000-0000-0000-0000-0000000115a1'
   AND r.active = true
   AND (r."appliedOn" = 'category' AND a.id IS NOT NULL OR r."appliedOn" = 'global')
 ORDER BY CASE r."appliedOn" WHEN 'item' THEN 0 WHEN 'category' THEN 1 ELSE 2 END,
          r."minQuantity" DESC, COALESCE(a.distancia, 0), r.sequence DESC, r."createdAt" DESC
 LIMIT 1;
-- Esperado: ('categoria hija', 30.00).

-- ---------------------------------------------------------------------------
-- Smoke 4 — la guarda de ciclos rechaza una cascada A → A.
-- Esperado: ERROR 'la cascada de listas base forma un ciclo'.
-- Descomentar para probar (aborta la transacción; correr en sesión aparte).
-- ---------------------------------------------------------------------------
-- INSERT INTO "ServicePriceRule" ("priceListId", "appliedOn", "computePrice", base, "basePriceListId")
-- VALUES ('00000000-0000-0000-0000-0000000115a1', 'global', 'formula', 'pricelist',
--         '00000000-0000-0000-0000-0000000115a1');

-- ---------------------------------------------------------------------------
-- Smoke 5 — los CHECK de coherencia rechazan una regla de categoría con código.
-- Esperado: ERROR de constraint spr_target_chk.
-- ---------------------------------------------------------------------------
-- INSERT INTO "ServicePriceRule" ("priceListId", "appliedOn", "itemCode", "categoryId", "computePrice", "fixedPrice")
-- VALUES ('00000000-0000-0000-0000-0000000115a1', 'category', 'SMOKE-01',
--         '00000000-0000-0000-0000-0000000c0de1', 'fixed', 1);

ROLLBACK;
