-- =============================================================================
-- 218_lab_rediseno_muestras_parametros.sql — Rediseño laboratorio 2026-09
-- (design/mockup/mockup_examenes_laboratorio.html)
--
-- El mockup introduce en el catálogo de laboratorio:
--   · TIPO de muestra parametrizable (antes solo enum fijo SpecimenType)
--   · SUBTIPO de muestra dependiente del tipo (no existía)
--   · Cantidad por defecto por prueba (HEMOCULTIVOS = 2)
--   · Parámetros (analitos) por prueba + selección por examen solicitado
--   · Cantidad por ítem de solicitud
--
-- LabPanel sigue siendo la "Sección" (decisión: extender legacy, no duplicar —
-- PORTAFOLIO_EX ya modela sección=panel). El enum SpecimenType se CONSERVA
-- para LabSpecimen (flujo de toma de muestra/IPSG.1); LabTest gana FKs a los
-- catálogos nuevos sin romper lo existente.
--
-- RLS: mismo patrón que sql/10 (catálogo global-o-tenant SELECT + tenant
-- modify; hijas de orden heredan por join). Idempotente.
-- =============================================================================

-- 1. Catálogo de tipos de muestra --------------------------------------------
CREATE TABLE IF NOT EXISTS public."LabSampleType" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid REFERENCES public."Organization"(id) ON DELETE CASCADE,
  name             varchar(120) NOT NULL,
  "displayOrder"   integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "LabSampleType_organizationId_name_key"
  ON public."LabSampleType" ("organizationId", name);
CREATE INDEX IF NOT EXISTS "LabSampleType_organizationId_active_idx"
  ON public."LabSampleType" ("organizationId", active);

-- 2. Catálogo de subtipos (dependiente del tipo) ------------------------------
CREATE TABLE IF NOT EXISTS public."LabSampleSubtype" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "sampleTypeId"   uuid NOT NULL REFERENCES public."LabSampleType"(id) ON DELETE CASCADE,
  name             varchar(120) NOT NULL,
  "displayOrder"   integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "LabSampleSubtype_sampleTypeId_name_key"
  ON public."LabSampleSubtype" ("sampleTypeId", name);
CREATE INDEX IF NOT EXISTS "LabSampleSubtype_organizationId_active_idx"
  ON public."LabSampleSubtype" ("organizationId", active);

-- 3. Parámetros por prueba ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public."LabTestParameter" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "labTestId"    uuid NOT NULL REFERENCES public."LabTest"(id) ON DELETE CASCADE,
  name           varchar(160) NOT NULL,
  "displayOrder" integer NOT NULL DEFAULT 0,
  "createdAt"    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "LabTestParameter_labTestId_name_key"
  ON public."LabTestParameter" ("labTestId", name);
CREATE INDEX IF NOT EXISTS "LabTestParameter_labTestId_idx"
  ON public."LabTestParameter" ("labTestId");

-- 4. Parámetros escogidos por examen solicitado -------------------------------
CREATE TABLE IF NOT EXISTS public."LabOrderItemParameter" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderItemId" uuid NOT NULL REFERENCES public."LabOrderItem"(id) ON DELETE CASCADE,
  "parameterId" uuid NOT NULL REFERENCES public."LabTestParameter"(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "LabOrderItemParameter_orderItemId_parameterId_key"
  ON public."LabOrderItemParameter" ("orderItemId", "parameterId");
CREATE INDEX IF NOT EXISTS "LabOrderItemParameter_orderItemId_idx"
  ON public."LabOrderItemParameter" ("orderItemId");

-- 5. Columnas nuevas en LabTest / LabOrderItem --------------------------------
ALTER TABLE public."LabTest"
  ADD COLUMN IF NOT EXISTS "sampleTypeId" uuid REFERENCES public."LabSampleType"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "sampleSubtypeId" uuid REFERENCES public."LabSampleSubtype"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "defaultQty" integer NOT NULL DEFAULT 1;

ALTER TABLE public."LabOrderItem"
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

-- 6. RLS + grants --------------------------------------------------------------
ALTER TABLE public."LabSampleType"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LabSampleSubtype"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LabTestParameter"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LabOrderItemParameter" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."LabSampleType"         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LabSampleSubtype"      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LabTestParameter"      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LabOrderItemParameter" TO authenticated;

-- Catálogos: global-o-tenant SELECT + tenant modify (patrón sql/10).
DROP POLICY IF EXISTS lab_sample_type_global_or_tenant_select ON public."LabSampleType";
CREATE POLICY lab_sample_type_global_or_tenant_select ON public."LabSampleType"
  FOR SELECT
  USING ("organizationId" IS NULL OR "organizationId" = public.current_org_id());

DROP POLICY IF EXISTS lab_sample_type_tenant_modify ON public."LabSampleType";
CREATE POLICY lab_sample_type_tenant_modify ON public."LabSampleType"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DROP POLICY IF EXISTS lab_sample_subtype_global_or_tenant_select ON public."LabSampleSubtype";
CREATE POLICY lab_sample_subtype_global_or_tenant_select ON public."LabSampleSubtype"
  FOR SELECT
  USING ("organizationId" IS NULL OR "organizationId" = public.current_org_id());

DROP POLICY IF EXISTS lab_sample_subtype_tenant_modify ON public."LabSampleSubtype";
CREATE POLICY lab_sample_subtype_tenant_modify ON public."LabSampleSubtype"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- Parámetros de prueba: heredan el tenant-scope de LabTest (global o tenant).
DROP POLICY IF EXISTS lab_test_parameter_select ON public."LabTestParameter";
CREATE POLICY lab_test_parameter_select ON public."LabTestParameter"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public."LabTest" t
    WHERE t.id = "LabTestParameter"."labTestId"
      AND (t."organizationId" IS NULL OR t."organizationId" = public.current_org_id())));

DROP POLICY IF EXISTS lab_test_parameter_tenant_modify ON public."LabTestParameter";
CREATE POLICY lab_test_parameter_tenant_modify ON public."LabTestParameter"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."LabTest" t
    WHERE t.id = "LabTestParameter"."labTestId"
      AND t."organizationId" = public.current_org_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."LabTest" t
    WHERE t.id = "LabTestParameter"."labTestId"
      AND t."organizationId" = public.current_org_id()));

-- Parámetros de ítem: heredan de la orden (dos saltos, patrón LabResult sql/10).
DROP POLICY IF EXISTS lab_order_item_parameter_tenant ON public."LabOrderItemParameter";
CREATE POLICY lab_order_item_parameter_tenant ON public."LabOrderItemParameter"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."LabOrderItem" i
    JOIN public."LabOrder" o ON o.id = i."orderId"
    WHERE i.id = "LabOrderItemParameter"."orderItemId"
      AND (o."organizationId" = public.current_org_id() OR public.is_break_glass())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."LabOrderItem" i
    JOIN public."LabOrder" o ON o.id = i."orderId"
    WHERE i.id = "LabOrderItemParameter"."orderItemId"
      AND o."organizationId" = public.current_org_id()));

-- updatedAt triggers (mismo helper que usa el resto del schema si existe).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_lab_sample_type_updated_at') THEN
      CREATE TRIGGER trg_lab_sample_type_updated_at BEFORE UPDATE ON public."LabSampleType"
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_lab_sample_subtype_updated_at') THEN
      CREATE TRIGGER trg_lab_sample_subtype_updated_at BEFORE UPDATE ON public."LabSampleSubtype"
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
  END IF;
END $$;
