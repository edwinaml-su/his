-- =============================================================================
-- 192_cc0016_modulo_imagenes.sql
-- CC-0016 — Módulo de Radiología e Imágenes (mockup) sobre el RIS legacy §18.
--
-- Fuente de verdad: docs/CC/0016/mockup_modulo_imagenes.html (677 líneas) —
--   3 tabs (Nueva Solicitud / Solicitudes del paciente / Parametrización),
--   catálogo RAW de 292 prestaciones en 5 categorías (esp/rx/rm/tac/usg),
--   derivaciones automáticas (código PREF+correlativo, contraste/ayuno por
--   regex, autorización si esp, duración por categoría), FIELDS (8 campos
--   configurables obligatorio/opcional/oculto), RULES (7 toggles + maxN).
--
-- Patrón: espejo de 189_cc0013_lab_examenes_cuenta_precio.sql (ALTER LabOrder
-- patientAccountId/encounterId nullable) + 176_cc0002_expediente.sql /
-- 187_cc0008b_sangre_no_identificado.sql (secuencia folio SECURITY DEFINER) +
-- 191_cc0015_tipo_cuenta_listas_precios.sql (tabla de parametrización tenant).
--
-- Cambios:
--   1. CREATE TABLE ImagingRequest — cabecera de solicitud (agrupa N
--      ImagingOrder hijas). El ESTADO NO es columna: se deriva del agregado
--      de sus ImagingOrder (mínimo en el orden ORDERED<SCHEDULED<IN_PROGRESS<
--      COMPLETED<REPORTED<VALIDATED — mapeado a pend/prog/real/inf en el
--      router). Ver comentario de columna más abajo.
--   2. Secuencia + fn_next_solicitud_imagen — folio SOL-{YYYY}-{NNNN}.
--   3. ALTER TABLE ImagingOrder — patientAccountId, requestId, conContraste,
--      notaEstudio + índices; encounterId DROP NOT NULL (patrón exacto SQL 189
--      sobre LabOrder: una cuenta ambulatoria puede no tener encounter).
--   4. CREATE TABLE ImagingTestAttrs — satélite 1:1 de LabTest (parametrización
--      de contraste/ayuno/autorización/duración/sala-equipo/preparación).
--   5. CREATE TABLE ImagingFormFieldConfig — parametrización de campos del
--      formulario de solicitud (dx/just/prio/fecha/embarazo/alergias/creat/obs).
--   6. CREATE TABLE ImagingModuleRule — reglas generales del módulo (toggles +
--      maxN configurable).
--   7. Desactiva (active=false) el catálogo RADIOLOGIA global CC-0011
--      (AVT-RAD-%, SQL 185) — CC-0016 lo reemplaza con el catálogo de 292
--      prestaciones sembrado por tenant (packages/database/scripts/
--      seed-imagenes-catalogo.mjs). Reversible (active=true). NO toca
--      AVT-CAR-*/AVT-LAB-* (cardiología/laboratorio fuera de alcance de este CC).
--
-- "updatedAt"/"createdAt" son NOT NULL sin default en algunas tablas Prisma
-- (@updatedAt) — se setean explícitos donde aplica (gotcha conocido, ver CLAUDE.md).
--
-- Idempotente. Aplicar vía Supabase SQL Editor / MCP (no prisma migrate).
-- NO aplicar a prod directamente: aprobado por @Orq en el gate de entrega.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ImagingRequest — cabecera de solicitud
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ImagingRequest" (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"   uuid        NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  folio              varchar(20) NOT NULL,
  "patientId"        uuid        NOT NULL REFERENCES public."Patient"(id) ON DELETE RESTRICT,
  "patientAccountId" uuid        REFERENCES public."PatientAccount"(id) ON DELETE SET NULL,
  "encounterId"      uuid        REFERENCES public."Encounter"(id) ON DELETE RESTRICT,
  prioridad          varchar(10) NOT NULL CHECK (prioridad IN ('ROUTINE', 'URGENT', 'STAT')),
  dx                 varchar(300),
  justificacion      text,
  "fechaDeseada"     date,
  embarazo           varchar(20),
  alergias           varchar(300),
  creatinina         varchar(40),
  observaciones      text,
  "firmadoPor"       uuid,
  "firmadoEn"        timestamptz,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "createdBy"        uuid,
  "updatedAt"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_imaging_request_org_folio UNIQUE ("organizationId", folio)
);

COMMENT ON TABLE public."ImagingRequest" IS
  'CC-0016 — cabecera de solicitud de radiología/imágenes (agrupa N ImagingOrder hijas). '
  'El ESTADO no es columna: se deriva en el router del mínimo estado de sus ImagingOrder '
  'en el orden ORDERED<SCHEDULED<IN_PROGRESS<COMPLETED<REPORTED<VALIDATED, mapeado a las '
  'etiquetas del mockup pend/prog/real/inf.';

CREATE INDEX IF NOT EXISTS idx_imaging_request_org ON public."ImagingRequest" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_imaging_request_patient ON public."ImagingRequest" ("patientId");
CREATE INDEX IF NOT EXISTS idx_imaging_request_account ON public."ImagingRequest" ("patientAccountId")
  WHERE "patientAccountId" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Secuencia de folio SOL-{YYYY}-{NNNN} — patrón exacto fn_next_expediente /
--    fn_next_no_identificado (upsert atómico SECURITY DEFINER).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.secuencia_solicitud_imagen (
  organization_id uuid NOT NULL,
  anio            int  NOT NULL,
  last_value      int  NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, anio)
);

COMMENT ON TABLE public.secuencia_solicitud_imagen IS
  'CC-0016 — correlativo anual por organización para el folio de solicitud de '
  'imágenes (SOL-{YYYY}-{NNNN}). Bucket = (organization_id, anio).';

CREATE OR REPLACE FUNCTION public.fn_next_solicitud_imagen(
  p_org  uuid,
  p_anio int
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v int;
BEGIN
  -- INSERT ... ON CONFLICT DO UPDATE es atómico bajo READ COMMITTED+: la fila
  -- se bloquea durante el upsert, sin race condition entre solicitudes concurrentes.
  INSERT INTO public.secuencia_solicitud_imagen (organization_id, anio, last_value)
    VALUES (p_org, p_anio, 1)
  ON CONFLICT (organization_id, anio)
    DO UPDATE SET last_value = public.secuencia_solicitud_imagen.last_value + 1
  RETURNING last_value INTO v;
  RETURN v;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. ImagingOrder — patientAccountId, requestId, conContraste, notaEstudio +
--    encounterId nullable (patrón exacto SQL 189 sobre LabOrder).
-- -----------------------------------------------------------------------------
ALTER TABLE public."ImagingOrder" ADD COLUMN IF NOT EXISTS "patientAccountId" uuid
  REFERENCES public."PatientAccount"(id) ON DELETE SET NULL;

ALTER TABLE public."ImagingOrder" ADD COLUMN IF NOT EXISTS "requestId" uuid
  REFERENCES public."ImagingRequest"(id) ON DELETE SET NULL;

ALTER TABLE public."ImagingOrder" ADD COLUMN IF NOT EXISTS "conContraste" boolean DEFAULT false;

ALTER TABLE public."ImagingOrder" ADD COLUMN IF NOT EXISTS "notaEstudio" text;

ALTER TABLE public."ImagingOrder" ALTER COLUMN "encounterId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS ix_imaging_order_patient_account ON public."ImagingOrder" ("patientAccountId");
CREATE INDEX IF NOT EXISTS ix_imaging_order_request ON public."ImagingOrder" ("requestId");

-- -----------------------------------------------------------------------------
-- 4. ImagingTestAttrs — satélite 1:1 de LabTest (parametrización del catálogo).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ImagingTestAttrs" (
  "labTestId"            uuid        PRIMARY KEY REFERENCES public."LabTest"(id) ON DELETE CASCADE,
  "requiereContraste"    boolean     NOT NULL DEFAULT false,
  "requiereAyuno"        boolean     NOT NULL DEFAULT false,
  "requiereAutorizacion" boolean     NOT NULL DEFAULT false,
  "duracionMin"          int         NOT NULL DEFAULT 20,
  "modalityType"         "ImagingModalityType" NOT NULL,
  "modalityId"           uuid        REFERENCES public."ImagingModality"(id) ON DELETE SET NULL,
  "preparacionPaciente"  text,
  "codigoTarifario"      varchar(40),
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."ImagingTestAttrs" IS
  'CC-0016 — atributos de parametrización del catálogo de imágenes (satélite 1:1 de '
  'LabTest, igual patrón que CC-0011/CC-0013 para radiología/laboratorio).';
COMMENT ON COLUMN public."ImagingTestAttrs"."codigoTarifario" IS
  'Alias de code para el price-resolver (CC-0015), fase 2 — NULL en el seed inicial.';

CREATE INDEX IF NOT EXISTS idx_imaging_test_attrs_modality ON public."ImagingTestAttrs" ("modalityId")
  WHERE "modalityId" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. ImagingFormFieldConfig — parametrización de campos del formulario.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ImagingFormFieldConfig" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid        NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "fieldKey"       varchar(30) NOT NULL,
  estado           varchar(15) NOT NULL CHECK (estado IN ('obligatorio', 'opcional', 'oculto')),
  "displayOrder"   int         NOT NULL DEFAULT 0,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_imaging_form_field_config_org_key UNIQUE ("organizationId", "fieldKey")
);

-- -----------------------------------------------------------------------------
-- 6. ImagingModuleRule — reglas generales del módulo.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."ImagingModuleRule" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid        NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "ruleKey"        varchar(20) NOT NULL,
  enabled          boolean     NOT NULL DEFAULT false,
  "valorNum"       int,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_imaging_module_rule_org_key UNIQUE ("organizationId", "ruleKey")
);

-- -----------------------------------------------------------------------------
-- 7. Seed defaults de ImagingFormFieldConfig/ImagingModuleRule por organización
--    real (excluye fixtures 'RLS-Test%'). Valores del mockup (FIELDS/RULES).
-- -----------------------------------------------------------------------------
INSERT INTO public."ImagingFormFieldConfig" ("organizationId", "fieldKey", estado, "displayOrder")
SELECT o.id, v.field_key, v.estado, v.display_order
FROM public."Organization" o
CROSS JOIN (VALUES
  ('dx',        'obligatorio', 0),
  ('just',      'obligatorio', 1),
  ('prio',      'obligatorio', 2),
  ('fecha',     'opcional',    3),
  ('embarazo',  'opcional',    4),
  ('alergias',  'opcional',    5),
  ('creat',     'opcional',    6),
  ('obs',       'oculto',      7)
) AS v(field_key, estado, display_order)
WHERE o."legalName" NOT LIKE 'RLS-Test%'
  AND NOT EXISTS (
    SELECT 1 FROM public."ImagingFormFieldConfig" f
    WHERE f."organizationId" = o.id AND f."fieldKey" = v.field_key
  );

INSERT INTO public."ImagingModuleRule" ("organizationId", "ruleKey", enabled, "valorNum")
SELECT o.id, v.rule_key, v.enabled, v.valor_num
FROM public."Organization" o
CROSS JOIN (VALUES
  ('multi',   true,  NULL::int),
  ('global',  true,  NULL::int),
  ('codigo',  false, NULL::int),
  ('flags',   true,  NULL::int),
  ('dupWarn', true,  NULL::int),
  ('firma',   false, NULL::int),
  ('maxN',    false, 10)
) AS v(rule_key, enabled, valor_num)
WHERE o."legalName" NOT LIKE 'RLS-Test%'
  AND NOT EXISTS (
    SELECT 1 FROM public."ImagingModuleRule" r
    WHERE r."organizationId" = o.id AND r."ruleKey" = v.rule_key
  );

-- -----------------------------------------------------------------------------
-- 8. Desactivar catálogo RADIOLOGIA global CC-0011 (reemplazado por CC-0016).
--    NO toca AVT-CAR-*/AVT-LAB-*.
-- -----------------------------------------------------------------------------
UPDATE public."LabTest" lt
SET active = false
FROM public."LabPanel" lp
WHERE lt."panelId" = lp.id
  AND lp.code LIKE 'AVT-RAD-%'
  AND lp."organizationId" IS NULL;

UPDATE public."LabPanel"
SET active = false
WHERE code LIKE 'AVT-RAD-%' AND "organizationId" IS NULL;

-- -----------------------------------------------------------------------------
-- 9. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public."ImagingRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ImagingTestAttrs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ImagingFormFieldConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ImagingModuleRule" ENABLE ROW LEVEL SECURITY;

-- ImagingRequest: tenant-isolation directo + break-glass en SELECT (patrón ImagingOrder, 16_imaging_rls.sql)
DROP POLICY IF EXISTS imaging_request_tenant_select ON public."ImagingRequest";
CREATE POLICY imaging_request_tenant_select ON public."ImagingRequest"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS imaging_request_tenant_modify ON public."ImagingRequest";
CREATE POLICY imaging_request_tenant_modify ON public."ImagingRequest"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- ImagingTestAttrs: satélite sin organizationId propio — hereda vía EXISTS join a LabTest
-- (patrón LabOrderItem en 10_lis_rls.sql). Los tests de imágenes de CC-0016 se siembran
-- por tenant (organizationId = org.id), nunca global.
DROP POLICY IF EXISTS imaging_test_attrs_inherit ON public."ImagingTestAttrs";
CREATE POLICY imaging_test_attrs_inherit ON public."ImagingTestAttrs"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public."LabTest" t
      WHERE t.id = "labTestId" AND t."organizationId" = public.current_org_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public."LabTest" t
      WHERE t.id = "labTestId" AND t."organizationId" = public.current_org_id()
    )
  );

-- ImagingFormFieldConfig / ImagingModuleRule: tenant-isolation directo (patrón TipoCuenta, SQL 191).
DROP POLICY IF EXISTS imaging_form_field_config_tenant ON public."ImagingFormFieldConfig";
CREATE POLICY imaging_form_field_config_tenant ON public."ImagingFormFieldConfig"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DROP POLICY IF EXISTS imaging_module_rule_tenant ON public."ImagingModuleRule";
CREATE POLICY imaging_module_rule_tenant ON public."ImagingModuleRule"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ImagingRequest" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ImagingTestAttrs" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ImagingFormFieldConfig" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ImagingModuleRule" TO authenticated;

-- -----------------------------------------------------------------------------
-- Verificación post-aplicación
-- -----------------------------------------------------------------------------
-- SELECT COUNT(*) FROM public."ImagingFormFieldConfig"; -- 8 por organización real
-- SELECT COUNT(*) FROM public."ImagingModuleRule";       -- 7 por organización real
-- SELECT COUNT(*) FROM public."LabPanel" WHERE code LIKE 'AVT-RAD-%' AND active = true; -- 0 (desactivado)
-- SELECT public.fn_next_solicitud_imagen('<org-uuid>'::uuid, 2026); -- 1, 2, 3... por org/año
