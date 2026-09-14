-- =============================================================================
-- 235_cc0028_seguros_operativos.sql
-- CC-0028 — Operar seguros en el HIS, espejo del modelo real de Odoo 18
-- (módulo ACS HMS, verificado read-only por @Orq vía MCP: 29 aseguradoras,
-- planes por ámbito cita/farmacia, ~1,915 pólizas de paciente, "Patient Share
-- Rules" por producto/categoría). El ciclo de claims (hms.insurance.claim, 0
-- registros en Odoo) NO se replica.
--
-- Regla de oro del repo (CLAUDE.md §Adecuar legacy): EXTIENDE Beta.14
-- (Insurer/InsurancePlan/PatientCoverage/AuthorizationRequest), no duplica.
-- InsurancePlan y PatientCoverage YA EXISTÍAN antes de este CC — este archivo
-- solo les agrega columnas + 3 tablas hijas nuevas.
--
-- Contenido:
--   a) InsurancePlan      — + priceListId (FK lógica ServicePriceList) + sequence.
--   b) InsurancePlanCoverage (nueva) — config de cobertura por ámbito del plan
--      (CONSULTA | FARMACIA | GENERAL). Tenancy heredada del plan → insurer
--      (sin columna organizationId propia — mismo patrón que
--      insurance_plan_inherit_insurer, sql/38).
--   c) PatientCoverage    — + carnet + contratante + priceListId (override).
--   d) PatientCoverageOverride (nueva) — espejo de (b) a nivel de póliza.
--      Tenancy heredada de PatientCoverage.organizationId.
--   e) CoverageRule (nueva) — "Patient Share Rules" (acs.insurance.policy.rule):
--      por CODIGO o CATEGORIA, a nivel de plan XOR póliza. organizationId
--      propio (no hereda) — requiere trigger de consistencia (mismo patrón
--      del guard de sql/204 para ServicePriceRule.categoryId).
--   f) RLS + grants + auditoría hash-chain (patrón sql/224/234) en las 3
--      tablas nuevas.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DO $$
-- guards, DROP POLICY/TRIGGER IF EXISTS). Requiere sql/204 aplicado
-- ("ServiceCategory" debe existir) y sql/234 aplicado (CoverageLetter,
-- referenciada solo en comentarios/documentación, no en FKs de este archivo).
-- APLICADO a prod 2026-09-14 vía MCP (proyecto ejacvsgbewcerxtjtwto) — NO re-aplicar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) InsurancePlan — columnas nuevas.
-- -----------------------------------------------------------------------------

ALTER TABLE public."InsurancePlan"
  ADD COLUMN IF NOT EXISTS "priceListId" uuid REFERENCES public."ServicePriceList"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence      int  NOT NULL DEFAULT 0;

COMMENT ON COLUMN public."InsurancePlan"."priceListId" IS
  'CC-0028 — lista de precios propia del plan (espejo de acs.insurance.plan.pricelist_id). FK lógica: sin relación Prisma, mismo patrón que TipoCuenta.priceListId.';

-- -----------------------------------------------------------------------------
-- b) InsurancePlanCoverage — config de cobertura por ámbito del plan.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."InsurancePlanCoverage" (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "planId"            uuid          NOT NULL REFERENCES public."InsurancePlan"(id) ON DELETE CASCADE,
  ambito              varchar(20)   NOT NULL,
  "coverageType"      varchar(24)   NOT NULL,
  "insuredPercentage" numeric(5,2),
  "copayAmount"       numeric(12,2),
  "coverageLimit"     numeric(14,2),
  active              boolean       NOT NULL DEFAULT true,
  "createdAt"         timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT insurance_plan_coverage_ambito_check
    CHECK (ambito IN ('CONSULTA', 'FARMACIA', 'GENERAL')),
  CONSTRAINT insurance_plan_coverage_type_check
    CHECK ("coverageType" IN ('PORCENTAJE', 'MONTO_FIJO', 'PORCENTAJE_CON_TOPE')),
  CONSTRAINT insurance_plan_coverage_fields_check
    CHECK (
      ("coverageType" = 'PORCENTAJE' AND "insuredPercentage" IS NOT NULL)
      OR ("coverageType" = 'MONTO_FIJO' AND "copayAmount" IS NOT NULL)
      OR ("coverageType" = 'PORCENTAJE_CON_TOPE' AND "insuredPercentage" IS NOT NULL AND "coverageLimit" IS NOT NULL)
    ),
  CONSTRAINT insurance_plan_coverage_unique UNIQUE ("planId", ambito)
);

COMMENT ON TABLE public."InsurancePlanCoverage" IS
  'CC-0028 — cobertura por ámbito (CONSULTA/FARMACIA/GENERAL) de un InsurancePlan, espejo de la separación cita/farmacia de acs.insurance.plan en Odoo. GENERAL = default para ámbitos no configurados (extensión sobre Odoo).';
COMMENT ON COLUMN public."InsurancePlanCoverage"."copayAmount" IS
  'Copago fijo. Bajo coverageType=MONTO_FIJO es la config completa (paciente paga esto, aseguradora el resto). Bajo PORCENTAJE/PORCENTAJE_CON_TOPE es un modificador opcional que siempre resta del lado asegurado hacia el paciente (ver packages/trpc/src/lib/coverage-resolver.ts).';

CREATE INDEX IF NOT EXISTS idx_insurance_plan_coverage_plan ON public."InsurancePlanCoverage" ("planId");

ALTER TABLE public."InsurancePlanCoverage" ENABLE ROW LEVEL SECURITY;

-- Tenancy heredada: plan -> insurer (organizationId NULL = catálogo global).
-- Mismo patrón que insurance_plan_inherit_insurer (sql/38).
DROP POLICY IF EXISTS insurance_plan_coverage_inherit_plan ON public."InsurancePlanCoverage";
CREATE POLICY insurance_plan_coverage_inherit_plan ON public."InsurancePlanCoverage"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."InsurancePlan" p
      JOIN public."Insurer" i ON i.id = p."insurerId"
      WHERE p.id = "InsurancePlanCoverage"."planId"
        AND (i."organizationId" IS NULL OR i."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public."InsurancePlan" p
      JOIN public."Insurer" i ON i.id = p."insurerId"
      WHERE p.id = "InsurancePlanCoverage"."planId"
        AND (i."organizationId" IS NULL OR i."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public."InsurancePlanCoverage" TO authenticated;

-- -----------------------------------------------------------------------------
-- c) PatientCoverage — columnas nuevas.
-- -----------------------------------------------------------------------------

ALTER TABLE public."PatientCoverage"
  ADD COLUMN IF NOT EXISTS carnet       varchar(80),
  ADD COLUMN IF NOT EXISTS contratante  varchar(200),
  ADD COLUMN IF NOT EXISTS "priceListId" uuid REFERENCES public."ServicePriceList"(id) ON DELETE SET NULL;

COMMENT ON COLUMN public."PatientCoverage".contratante IS
  'CC-0028 — persona/entidad contratante de la póliza (espejo de hms.patient.insurance), puede diferir del paciente cubierto.';
COMMENT ON COLUMN public."PatientCoverage"."priceListId" IS
  'CC-0028 — override de InsurancePlan.priceListId para esta póliza específica. FK lógica, sin relación Prisma.';

-- -----------------------------------------------------------------------------
-- d) PatientCoverageOverride — espejo de (b) a nivel de póliza.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."PatientCoverageOverride" (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "coverageId"        uuid          NOT NULL REFERENCES public."PatientCoverage"(id) ON DELETE CASCADE,
  ambito              varchar(20)   NOT NULL,
  "coverageType"      varchar(24)   NOT NULL,
  "insuredPercentage" numeric(5,2),
  "copayAmount"       numeric(12,2),
  "coverageLimit"     numeric(14,2),
  active              boolean       NOT NULL DEFAULT true,
  "createdAt"         timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT patient_coverage_override_ambito_check
    CHECK (ambito IN ('CONSULTA', 'FARMACIA', 'GENERAL')),
  CONSTRAINT patient_coverage_override_type_check
    CHECK ("coverageType" IN ('PORCENTAJE', 'MONTO_FIJO', 'PORCENTAJE_CON_TOPE')),
  CONSTRAINT patient_coverage_override_fields_check
    CHECK (
      ("coverageType" = 'PORCENTAJE' AND "insuredPercentage" IS NOT NULL)
      OR ("coverageType" = 'MONTO_FIJO' AND "copayAmount" IS NOT NULL)
      OR ("coverageType" = 'PORCENTAJE_CON_TOPE' AND "insuredPercentage" IS NOT NULL AND "coverageLimit" IS NOT NULL)
    ),
  CONSTRAINT patient_coverage_override_unique UNIQUE ("coverageId", ambito)
);

COMMENT ON TABLE public."PatientCoverageOverride" IS
  'CC-0028 — override de PatientCoverage sobre la config por ámbito heredada del plan (InsurancePlanCoverage). Misma forma que la tabla del plan; ver precedencia en packages/trpc/src/lib/coverage-resolver.ts.';

CREATE INDEX IF NOT EXISTS idx_patient_coverage_override_coverage ON public."PatientCoverageOverride" ("coverageId");

ALTER TABLE public."PatientCoverageOverride" ENABLE ROW LEVEL SECURITY;

-- Tenancy heredada de PatientCoverage.organizationId (siempre tenant, nunca global).
DROP POLICY IF EXISTS patient_coverage_override_inherit ON public."PatientCoverageOverride";
CREATE POLICY patient_coverage_override_inherit ON public."PatientCoverageOverride"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."PatientCoverage" pc
      WHERE pc.id = "PatientCoverageOverride"."coverageId"
        AND pc."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public."PatientCoverage" pc
      WHERE pc.id = "PatientCoverageOverride"."coverageId"
        AND pc."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public."PatientCoverageOverride" TO authenticated;

-- -----------------------------------------------------------------------------
-- e) CoverageRule — "Patient Share Rules" (acs.insurance.policy.rule).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."CoverageRule" (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"    uuid          NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "planId"            uuid          REFERENCES public."InsurancePlan"(id) ON DELETE CASCADE,
  "coverageId"        uuid          REFERENCES public."PatientCoverage"(id) ON DELETE CASCADE,
  "ruleOn"            varchar(12)   NOT NULL,
  "serviceCategoryId" uuid          REFERENCES public."ServiceCategory"(id) ON DELETE SET NULL,
  code                varchar(40),
  "ruleType"          varchar(12)   NOT NULL,
  percentage          numeric(5,2),
  amount              numeric(12,2),
  "fullCover"         boolean       NOT NULL DEFAULT false,
  sequence            int           NOT NULL DEFAULT 0,
  active              boolean       NOT NULL DEFAULT true,
  "createdAt"         timestamptz   NOT NULL DEFAULT now(),
  "createdBy"         uuid,
  "updatedAt"         timestamptz   NOT NULL DEFAULT now(),
  "updatedBy"         uuid,

  CONSTRAINT coverage_rule_scope_xor_check
    CHECK (
      ("planId" IS NOT NULL AND "coverageId" IS NULL)
      OR ("planId" IS NULL AND "coverageId" IS NOT NULL)
    ),
  CONSTRAINT coverage_rule_on_check CHECK ("ruleOn" IN ('CATEGORIA', 'CODIGO')),
  CONSTRAINT coverage_rule_on_fields_check
    CHECK (
      ("ruleOn" = 'CATEGORIA' AND "serviceCategoryId" IS NOT NULL AND code IS NULL)
      OR ("ruleOn" = 'CODIGO' AND code IS NOT NULL AND "serviceCategoryId" IS NULL)
    ),
  CONSTRAINT coverage_rule_type_check CHECK ("ruleType" IN ('PORCENTAJE', 'MONTO')),
  CONSTRAINT coverage_rule_type_fields_check
    CHECK (
      "fullCover" = true
      OR ("ruleType" = 'PORCENTAJE' AND percentage IS NOT NULL)
      OR ("ruleType" = 'MONTO' AND amount IS NOT NULL)
    )
);

COMMENT ON TABLE public."CoverageRule" IS
  'CC-0028 — espejo de acs.insurance.policy.rule ("Patient Share Rules"): % o monto cubierto por código de tarifario o categoría, a nivel de plan XOR de una póliza específica. fullCover=true cubre el 100% sin importar ruleType.';
COMMENT ON COLUMN public."CoverageRule"."serviceCategoryId" IS
  'FK lógica a "ServiceCategory" (CC-0021, tabla SQL sin modelo Prisma — mismo patrón que ServicePriceRule.categoryId). Requerida cuando ruleOn = CATEGORIA.';

CREATE INDEX IF NOT EXISTS idx_coverage_rule_org        ON public."CoverageRule" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_coverage_rule_plan        ON public."CoverageRule" ("planId")     WHERE "planId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_rule_coverage    ON public."CoverageRule" ("coverageId")  WHERE "coverageId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_rule_category    ON public."CoverageRule" ("serviceCategoryId") WHERE "serviceCategoryId" IS NOT NULL;

ALTER TABLE public."CoverageRule" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coverage_rule_tenant ON public."CoverageRule";
CREATE POLICY coverage_rule_tenant ON public."CoverageRule"
  FOR ALL TO authenticated
  USING ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public."CoverageRule" TO authenticated;

-- CoverageRule.organizationId no se hereda de planId/coverageId (columna
-- propia, como AccountReceivable/CoverageLetter) — puede quedar inconsistente
-- si un tenant crea una regla apuntando al plan/póliza de otro tenant. Guard
-- explícito, mismo patrón que fn_service_price_rule_org_guard (sql/204):
--   - planId: el insurer del plan debe ser global (organizationId NULL) o
--     pertenecer al mismo tenant que la regla.
--   - coverageId: la póliza debe pertenecer al mismo tenant que la regla
--     (PatientCoverage.organizationId siempre es tenant, nunca NULL).
CREATE OR REPLACE FUNCTION public.fn_coverage_rule_org_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_org_insurer uuid;
  v_org_coverage uuid;
BEGIN
  IF NEW."planId" IS NOT NULL THEN
    SELECT i."organizationId" INTO v_org_insurer
      FROM public."InsurancePlan" p
      JOIN public."Insurer" i ON i.id = p."insurerId"
     WHERE p.id = NEW."planId";
    IF v_org_insurer IS NOT NULL AND v_org_insurer IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'CoverageRule: el plan % no pertenece a la organización %', NEW."planId", NEW."organizationId";
    END IF;
  END IF;

  IF NEW."coverageId" IS NOT NULL THEN
    SELECT pc."organizationId" INTO v_org_coverage
      FROM public."PatientCoverage" pc
     WHERE pc.id = NEW."coverageId";
    IF v_org_coverage IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'CoverageRule: la póliza % no pertenece a la organización %', NEW."coverageId", NEW."organizationId";
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coverage_rule_org_guard ON public."CoverageRule";
CREATE TRIGGER trg_coverage_rule_org_guard
  BEFORE INSERT OR UPDATE ON public."CoverageRule"
  FOR EACH ROW EXECUTE FUNCTION public.fn_coverage_rule_org_guard();

-- -----------------------------------------------------------------------------
-- f) Auditoría — hash-chain, mismo patrón que sql/224/234 (reutiliza
--    audit.fn_audit_row(), SECURITY DEFINER; NO se crea función nueva).
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  financieras text[] := ARRAY['InsurancePlanCoverage', 'PatientCoverageOverride', 'CoverageRule'];
BEGIN
  FOREACH t IN ARRAY financieras LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_' || t, t);
    EXECUTE format(
      'CREATE TRIGGER %I
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row()',
      'trg_audit_' || t, t
    );
  END LOOP;
END $$;

-- =============================================================================
-- Verificación manual post-apply:
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'InsurancePlan' AND column_name = 'priceListId';        -- 1
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'PatientCoverage' AND column_name = 'carnet';           -- 1
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = ANY (ARRAY['"InsurancePlanCoverage"','"PatientCoverageOverride"','"CoverageRule"']::regclass[])
--      AND tgname LIKE 'trg_audit_%';                                           -- 3 filas
--   SELECT tgname FROM pg_trigger WHERE tgrelid = '"CoverageRule"'::regclass
--      AND tgname = 'trg_coverage_rule_org_guard';                              -- 1 fila
-- =============================================================================
