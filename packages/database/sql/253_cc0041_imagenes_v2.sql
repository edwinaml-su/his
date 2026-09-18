-- =============================================================================
-- 253_cc0041_imagenes_v2.sql — CC-0041: Módulo de imágenes v2
-- (docs/CC/CC0041/REQUERIMIENTO_modulo_imagenes.md + mockup v2)
--
-- v2 sobre CC-0016 (sql/192):
--   1. RF-03 — dx desde el expediente: snapshot con sistema de codificación,
--      fuente y id de origen (trazabilidad). `dx` existente conserva
--      "código — descripción".
--   2. SLA parametrizable por prioridad para las tareas de imagenología
--      (espejo exacto de LabSlaConfig, sql/251 — extensión CC-0040).
--      Fallback en código: STAT 60' / URGENT 240' / ROUTINE 1440'.
--
-- Precios por prestación: NO requiere DDL — LabTest."standardPrice" (CC-0013)
-- ya existe; el CRUD del catálogo de imágenes lo expone en este CC.
-- Tareas por prestación: CareTask sourceType 'IMAGING_ORDER' ya está en el
-- CHECK (sql/209) — una ImagingOrder ES una prestación. Idempotente.
-- =============================================================================

-- 1. RF-03 — snapshot del diagnóstico del expediente -------------------------
ALTER TABLE public."ImagingRequest"
  ADD COLUMN IF NOT EXISTS "dxSistema" varchar(10)
    CHECK ("dxSistema" IS NULL OR "dxSistema" IN ('CIE10', 'CIE11')),
  ADD COLUMN IF NOT EXISTS "dxFuente" varchar(120),
  ADD COLUMN IF NOT EXISTS "dxOrigenId" uuid;

COMMENT ON COLUMN public."ImagingRequest"."dxSistema" IS
  'CC-0041 RF-03 — sistema de codificación del dx copiado (CIE10 legado / CIE11).';
COMMENT ON COLUMN public."ImagingRequest"."dxFuente" IS
  'CC-0041 RF-03 — fuente del dx en el expediente (Historia Clínica / Evolución / Indicaciones / Manual).';
COMMENT ON COLUMN public."ImagingRequest"."dxOrigenId" IS
  'CC-0041 RF-03 — id de la fila de origen del dx (sin FK: polimórfico por fuente).';

-- 1b. RF-06 — "¿Posibilidad de embarazo?" es obligatoria SIEMPRE (CA-12:
--     no puede configurarse por debajo). Se actualiza el seed de SQL 192
--     (que la dejó 'opcional') y el server rechaza cambios futuros.
UPDATE public."ImagingFormFieldConfig"
SET estado = 'obligatorio'
WHERE "fieldKey" = 'embarazo' AND estado <> 'obligatorio';

-- 2. SLA parametrizable de imagenología (espejo de LabSlaConfig, sql/251) ----
CREATE TABLE IF NOT EXISTS public."ImagingSlaConfig" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  priority         varchar(10) NOT NULL CHECK (priority IN ('ROUTINE', 'URGENT', 'STAT')),
  "slaMinutes"     integer NOT NULL CHECK ("slaMinutes" > 0 AND "slaMinutes" <= 10080),
  "warningMinutes" integer NOT NULL DEFAULT 30 CHECK ("warningMinutes" >= 0),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ImagingSlaConfig_organizationId_priority_key"
  ON public."ImagingSlaConfig" ("organizationId", priority);

ALTER TABLE public."ImagingSlaConfig" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ImagingSlaConfig" TO authenticated;

DROP POLICY IF EXISTS imaging_sla_config_tenant ON public."ImagingSlaConfig";
CREATE POLICY imaging_sla_config_tenant ON public."ImagingSlaConfig"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_imaging_sla_config_updated_at') THEN
      CREATE TRIGGER trg_imaging_sla_config_updated_at BEFORE UPDATE ON public."ImagingSlaConfig"
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
  END IF;
END $$;
