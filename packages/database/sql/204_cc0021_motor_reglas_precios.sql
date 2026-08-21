-- =============================================================================
-- 204_cc0021_motor_reglas_precios.sql
-- CC-0021 — Motor de reglas de listas de precios (réplica de product.pricelist
--           de Odoo 18, verificado contra odoo.complejoavante.com el 2026-08-21).
--
-- Contexto:
--   CC-0015 importó las 20 listas reales de Odoo como pares planos
--   (code → unitPrice) en "ServicePriceListItem". Eso cubre el 99.9% del uso
--   real de Odoo (3,672 de 3,674 reglas son `fixed` sobre un producto), pero
--   descarta lo que un ítem plano no sabe expresar:
--     · reglas por CATEGORÍA de producto      (2 reglas reales; por eso la
--       lista «DrSV - IMAGENES» quedó con 0 ítems tras el seed de CC-0015)
--     · precio calculado (`percentage` / `formula`: descuento, recargo,
--       redondeo, márgenes mín/máx sobre un precio base)
--     · precio base distinto del catálogo (costo, u otra lista → cascada)
--     · tramos por cantidad mínima
--     · vigencia POR REGLA (4 reglas reales), no solo por lista
--
-- Este SQL añade esas capacidades sin tocar los 10,602 ítems ya importados:
--   a) "ServiceCategory"       — árbol de categorías de servicio/producto por
--                                org (equivalente a product.category).
--   b) "ServicePriceListItem"."categoryId" — clasifica el ítem del tarifario.
--   c) "ServicePriceRule"      — reglas de precio (equivalente a
--                                product.pricelist.item).
--
-- DECISIÓN DE DISEÑO (ver docs/CC/0021):
--   El ítem plano NO se migra a regla. "ServicePriceListItem" se comporta como
--   la regla implícita `appliedOn='item' / computePrice='fixed' / minQuantity=0
--   / sin vigencia` — que es exactamente la forma del 99.9% de las reglas de
--   Odoo. El resolver lo proyecta dentro del mismo ranking que las reglas
--   explícitas, con la prioridad más baja de su nivel de especificidad
--   (una regla explícita del mismo código gana). Así no se duplican 10,602
--   filas ni se rompe ningún consumidor existente del tarifario.
--
-- Idempotente: reejecutable sin duplicar filas ni perder datos.
-- APLICADO A PROD el 2026-08-21 vía MCP (migración cc0021_motor_reglas_precios).
-- NO RE-APLICAR salvo para reconstruir la BD desde cero.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) "ServiceCategory" — árbol de categorías (product.category de Odoo).
--    El árbol permite que una regla de categoría aplique también a las
--    subcategorías (Odoo usa `child_of`); el resolver rankea por distancia
--    (la categoría más específica gana).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ServiceCategory" (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid         NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  code             varchar(40)  NOT NULL,
  nombre           varchar(120) NOT NULL,
  "parentId"       uuid         REFERENCES public."ServiceCategory"(id) ON DELETE RESTRICT,
  "odooCategId"    integer,
  active           boolean      NOT NULL DEFAULT true,
  "createdAt"      timestamptz  NOT NULL DEFAULT now(),
  "createdBy"      uuid,
  "updatedAt"      timestamptz  NOT NULL DEFAULT now(),
  "updatedBy"      uuid,
  CONSTRAINT uq_service_category_org_code UNIQUE ("organizationId", code),
  CONSTRAINT service_category_no_self_parent CHECK ("parentId" IS NULL OR "parentId" <> id)
);

COMMENT ON TABLE public."ServiceCategory" IS
  'CC-0021 — Categoría de servicio/producto facturable (equivalente a product.category de Odoo). Permite reglas de precio que aplican a una familia entera.';
COMMENT ON COLUMN public."ServiceCategory"."odooCategId" IS
  'id de product.category en Odoo, para trazabilidad del importador. NULL = categoría creada en el HIS.';

CREATE INDEX IF NOT EXISTS idx_service_category_org    ON public."ServiceCategory" ("organizationId", active);
CREATE INDEX IF NOT EXISTS idx_service_category_parent ON public."ServiceCategory" ("parentId") WHERE "parentId" IS NOT NULL;

ALTER TABLE public."ServiceCategory" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_category_tenant ON public."ServiceCategory";
CREATE POLICY service_category_tenant ON public."ServiceCategory"
  FOR ALL TO authenticated
  USING (
    "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ServiceCategory" TO authenticated;

-- -----------------------------------------------------------------------------
-- b) Clasificación del ítem de tarifario.
-- -----------------------------------------------------------------------------
ALTER TABLE public."ServicePriceListItem"
  ADD COLUMN IF NOT EXISTS "categoryId" uuid REFERENCES public."ServiceCategory"(id) ON DELETE SET NULL;

COMMENT ON COLUMN public."ServicePriceListItem"."categoryId" IS
  'CC-0021 — Categoría del ítem. La usan las reglas de precio con appliedOn = ''category''.';

CREATE INDEX IF NOT EXISTS idx_spl_item_category
  ON public."ServicePriceListItem" ("categoryId")
  WHERE "categoryId" IS NOT NULL;

-- b.2) Clasificación del catálogo de exámenes/estudios.
--      En Odoo la categoría vive en el PRODUCTO (global), no en la línea de la
--      lista. El equivalente global del HIS para exámenes de laboratorio e
--      imágenes es "LabTest" (CC-0013 / CC-0016). Sin esto, una regla de
--      categoría no podría aplicar a un código que no está en la lista — que es
--      justo el caso de «DrSV - IMAGENES», cuyo único precio es una regla de
--      categoría y no tiene ningún ítem.
--      Nota: las filas globales del catálogo ("organizationId" IS NULL) no deben
--      llevar categoría, porque ServiceCategory es org-scoped.
-- -----------------------------------------------------------------------------
ALTER TABLE public."LabTest"
  ADD COLUMN IF NOT EXISTS "categoryId" uuid REFERENCES public."ServiceCategory"(id) ON DELETE SET NULL;

COMMENT ON COLUMN public."LabTest"."categoryId" IS
  'CC-0021 — Categoría de servicio del examen/estudio. La usan las reglas de precio con appliedOn = ''category'' cuando el código no está en el tarifario. Solo para filas tenant-scoped.';

CREATE INDEX IF NOT EXISTS idx_lab_test_category
  ON public."LabTest" ("categoryId")
  WHERE "categoryId" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- c) "ServicePriceRule" — regla de precio (product.pricelist.item de Odoo).
--
--    Mapeo de campos Odoo → HIS:
--      applied_on 0_product_variant / 1_product → 'item'   (el HIS no maneja
--                                                           variantes de producto)
--      applied_on 2_product_category            → 'category'
--      applied_on 3_global                      → 'global'
--      compute_price fixed/percentage/formula   → "computePrice" (igual)
--      base list_price                          → 'list_price'    (precio de
--                                                  catálogo: ítem de la lista
--                                                  o LabTest.standardPrice)
--      base standard_price                      → 'standard_cost' (estimatedCost)
--      base pricelist                           → 'pricelist'     (cascada)
--      price_discount / price_surcharge / price_round /
--      price_min_margin / price_max_margin      → homónimos
--      price_markup                             → NO se persiste: en Odoo es el
--                                                 espejo del descuento
--                                                 (verificado: la única regla
--                                                 real trae discount=-6.38 y
--                                                 markup=+6.38). El motor usa
--                                                 "priceDiscount"; un markup se
--                                                 guarda como descuento negativo.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ServicePriceRule" (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  "priceListId"     uuid           NOT NULL REFERENCES public."ServicePriceList"(id) ON DELETE CASCADE,
  "appliedOn"       varchar(10)    NOT NULL DEFAULT 'item',
  "itemCode"        varchar(60),
  "categoryId"      uuid           REFERENCES public."ServiceCategory"(id) ON DELETE CASCADE,
  "minQuantity"     numeric(12,3)  NOT NULL DEFAULT 0,
  "dateStart"       timestamptz,
  "dateEnd"         timestamptz,
  "computePrice"    varchar(12)    NOT NULL DEFAULT 'fixed',
  "fixedPrice"      numeric(14,2),
  "percentPrice"    numeric(7,3)   NOT NULL DEFAULT 0,
  base              varchar(16)    NOT NULL DEFAULT 'list_price',
  "basePriceListId" uuid           REFERENCES public."ServicePriceList"(id) ON DELETE RESTRICT,
  "priceDiscount"   numeric(7,3)   NOT NULL DEFAULT 0,
  "priceSurcharge"  numeric(14,2)  NOT NULL DEFAULT 0,
  "priceRound"      numeric(14,4)  NOT NULL DEFAULT 0,
  "priceMinMargin"  numeric(14,2)  NOT NULL DEFAULT 0,
  "priceMaxMargin"  numeric(14,2)  NOT NULL DEFAULT 0,
  sequence          integer        NOT NULL DEFAULT 0,
  notes             varchar(300),
  "odooItemId"      integer,
  active            boolean        NOT NULL DEFAULT true,
  "createdAt"       timestamptz    NOT NULL DEFAULT now(),
  "createdBy"       uuid,
  "updatedAt"       timestamptz    NOT NULL DEFAULT now(),
  "updatedBy"       uuid,

  CONSTRAINT spr_applied_on_chk
    CHECK ("appliedOn" IN ('item', 'category', 'global')),
  CONSTRAINT spr_compute_price_chk
    CHECK ("computePrice" IN ('fixed', 'percentage', 'formula')),
  CONSTRAINT spr_base_chk
    CHECK (base IN ('list_price', 'standard_cost', 'pricelist')),
  -- El objetivo de la regla debe corresponder a su nivel de aplicación.
  CONSTRAINT spr_target_chk CHECK (
    ("appliedOn" = 'item'     AND "itemCode" IS NOT NULL AND "categoryId" IS NULL) OR
    ("appliedOn" = 'category' AND "categoryId" IS NOT NULL AND "itemCode" IS NULL) OR
    ("appliedOn" = 'global'   AND "itemCode" IS NULL AND "categoryId" IS NULL)
  ),
  -- Un precio fijo necesita el monto; los calculados no lo usan.
  CONSTRAINT spr_fixed_price_chk
    CHECK ("computePrice" <> 'fixed' OR "fixedPrice" IS NOT NULL),
  -- La cascada necesita lista base, y solo la cascada la admite.
  CONSTRAINT spr_base_pricelist_chk CHECK (
    (base = 'pricelist' AND "basePriceListId" IS NOT NULL AND "basePriceListId" <> "priceListId") OR
    (base <> 'pricelist' AND "basePriceListId" IS NULL)
  ),
  CONSTRAINT spr_min_quantity_chk CHECK ("minQuantity" >= 0),
  CONSTRAINT spr_price_round_chk  CHECK ("priceRound" >= 0),
  CONSTRAINT spr_vigencia_chk     CHECK ("dateEnd" IS NULL OR "dateStart" IS NULL OR "dateEnd" >= "dateStart")
);

COMMENT ON TABLE public."ServicePriceRule" IS
  'CC-0021 — Regla de precio de una lista (réplica de product.pricelist.item de Odoo). Gana la primera regla que matchea, ordenada por especificidad → minQuantity desc → categoría más específica → sequence desc → creación desc.';
COMMENT ON COLUMN public."ServicePriceRule"."appliedOn" IS
  'Nivel de aplicación: item (un código del tarifario) | category (una familia y sus hijas) | global (toda la lista).';
COMMENT ON COLUMN public."ServicePriceRule"."computePrice" IS
  'fixed = "fixedPrice" tal cual · percentage = base menos "percentPrice"% · formula = descuento → redondeo → recargo → márgenes mín/máx sobre el base.';
COMMENT ON COLUMN public."ServicePriceRule".base IS
  'Precio base del cálculo: list_price (catálogo) | standard_cost (estimatedCost del ítem) | pricelist (resultado de "basePriceListId", cascada).';
COMMENT ON COLUMN public."ServicePriceRule"."priceDiscount" IS
  'Descuento % sobre el base. Negativo = markup (así lo guarda Odoo: la regla real de INSUMOS trae -6.38 = +6.38% sobre el precio de catálogo).';
COMMENT ON COLUMN public."ServicePriceRule"."priceRound" IS
  'Redondea a múltiplo de este valor. 0 = sin redondeo. Se aplica DESPUÉS del descuento y ANTES del recargo (orden documentado por Odoo).';
COMMENT ON COLUMN public."ServicePriceRule"."priceMinMargin" IS
  'Margen mínimo absoluto sobre el precio base: el resultado nunca queda por debajo de base + este valor. 0 = sin piso.';
COMMENT ON COLUMN public."ServicePriceRule"."priceMaxMargin" IS
  'Margen máximo absoluto sobre el precio base: el resultado nunca supera base + este valor. 0 = sin techo.';
COMMENT ON COLUMN public."ServicePriceRule".sequence IS
  'Desempate manual entre reglas del mismo nivel: mayor sequence gana. El ítem plano del tarifario se evalúa como sequence -1 (pierde ante cualquier regla explícita del mismo código).';
COMMENT ON COLUMN public."ServicePriceRule"."odooItemId" IS
  'id de product.pricelist.item en Odoo, para que el importador sea idempotente. NULL = regla creada en el HIS.';

CREATE INDEX IF NOT EXISTS idx_spr_list        ON public."ServicePriceRule" ("priceListId", active);
CREATE INDEX IF NOT EXISTS idx_spr_list_code   ON public."ServicePriceRule" ("priceListId", "itemCode") WHERE "itemCode" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spr_category    ON public."ServicePriceRule" ("categoryId") WHERE "categoryId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spr_base_list   ON public."ServicePriceRule" ("basePriceListId") WHERE "basePriceListId" IS NOT NULL;

-- Idempotencia del importador Odoo: una regla por (lista, item de Odoo).
CREATE UNIQUE INDEX IF NOT EXISTS ux_spr_list_odoo_item
  ON public."ServicePriceRule" ("priceListId", "odooItemId")
  WHERE "odooItemId" IS NOT NULL;

ALTER TABLE public."ServicePriceRule" ENABLE ROW LEVEL SECURITY;

-- Tenant vía la lista dueña, mismo patrón que ServicePriceListItem (sql/133).
DROP POLICY IF EXISTS service_price_rule_tenant ON public."ServicePriceRule";
CREATE POLICY service_price_rule_tenant ON public."ServicePriceRule"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."ServicePriceList" pl
       WHERE pl.id = "ServicePriceRule"."priceListId"
         AND pl."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public."ServicePriceList" pl
       WHERE pl.id = "ServicePriceRule"."priceListId"
         AND pl."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ServicePriceRule" TO authenticated;

-- -----------------------------------------------------------------------------
-- d) Guardas de integridad que un CHECK no alcanza a expresar (cruzan filas).
--    Ambas funciones declaran search_path fijo — requisito del proyecto para
--    toda función nueva (advisor function_search_path_mutable).
-- -----------------------------------------------------------------------------

-- d.1) La categoría de una regla debe pertenecer a la misma org que la lista.
CREATE OR REPLACE FUNCTION public.fn_spr_assert_categoria_misma_org()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_org_lista uuid;
  v_org_categ uuid;
BEGIN
  IF NEW."categoryId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pl."organizationId" INTO v_org_lista
    FROM public."ServicePriceList" pl WHERE pl.id = NEW."priceListId";
  SELECT sc."organizationId" INTO v_org_categ
    FROM public."ServiceCategory" sc WHERE sc.id = NEW."categoryId";

  IF v_org_lista IS DISTINCT FROM v_org_categ THEN
    RAISE EXCEPTION 'ServicePriceRule: la categoría % no pertenece a la organización de la lista %',
      NEW."categoryId", NEW."priceListId";
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spr_categoria_misma_org ON public."ServicePriceRule";
CREATE TRIGGER trg_spr_categoria_misma_org
  BEFORE INSERT OR UPDATE OF "categoryId", "priceListId" ON public."ServicePriceRule"
  FOR EACH ROW EXECUTE FUNCTION public.fn_spr_assert_categoria_misma_org();

-- d.2) La cascada de listas base no puede tener ciclos (A → B → A) ni pasar de
--      5 niveles. Odoo lo evita con una constraint recursiva equivalente.
CREATE OR REPLACE FUNCTION public.fn_spr_assert_cascada_sin_ciclo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actual uuid;
  v_nivel  integer := 0;
BEGIN
  IF NEW."basePriceListId" IS NULL THEN
    RETURN NEW;
  END IF;

  v_actual := NEW."basePriceListId";

  WHILE v_actual IS NOT NULL LOOP
    v_nivel := v_nivel + 1;

    IF v_actual = NEW."priceListId" THEN
      RAISE EXCEPTION 'ServicePriceRule: la cascada de listas base forma un ciclo en la lista %', NEW."priceListId";
    END IF;

    IF v_nivel > 5 THEN
      RAISE EXCEPTION 'ServicePriceRule: la cascada de listas base excede 5 niveles';
    END IF;

    SELECT r."basePriceListId" INTO v_actual
      FROM public."ServicePriceRule" r
     WHERE r."priceListId" = v_actual
       AND r."basePriceListId" IS NOT NULL
       AND r.active = true
     LIMIT 1;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spr_cascada_sin_ciclo ON public."ServicePriceRule";
CREATE TRIGGER trg_spr_cascada_sin_ciclo
  BEFORE INSERT OR UPDATE OF "basePriceListId", "priceListId" ON public."ServicePriceRule"
  FOR EACH ROW EXECUTE FUNCTION public.fn_spr_assert_cascada_sin_ciclo();

-- =============================================================================
-- Verificación post-aplicación (ejecutar aparte):
--
--   SELECT COUNT(*) FROM "ServiceCategory";      -- 42 tras el importador (14 x 3 orgs)
--   SELECT COUNT(*) FROM "ServicePriceRule";     -- 999 tras el importador (333 x 3 orgs)
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = '"ServicePriceRule"'::regclass ORDER BY conname;  -- 9 CHECK
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = '"ServicePriceRule"'::regclass AND NOT tgisinternal; -- 2
-- =============================================================================
