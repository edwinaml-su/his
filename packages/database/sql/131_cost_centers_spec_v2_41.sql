-- =============================================================================
-- 131_cost_centers_spec_v2_41.sql
-- Wave 8 — Cost Centers según requerimientos-centros-costo-his.md
--
-- Extiende CostCenter con tipo (productivo/intermedio/apoyo), permite_imputacion,
-- responsableId, baseDistribucion, centroResponsableMinsal, cuentas contables.
-- Codificación T-AAA-SSS (CHECK regex).
-- Crea CostCenterAllocationRule + CostCenterAllocationTarget para prorrateo.
-- Trigger: suma de porcentajes por regla = 100% (DEFERRABLE).
-- Seed: 41 centros para Hospital Avante Central.
--
-- Aplicado a prod 2026-05-25 vía MCP
-- (migration: cost_centers_spec_v2_41_seed_2026_05_25).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE cost_center_type AS ENUM ('productivo', 'intermedio', 'apoyo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cost_distribution_base AS ENUM (
    'metros_cuadrados', 'numero_empleados', 'horas_trabajadas',
    'pacientes_atendidos', 'kilos_lavados', 'consumo_directo', 'porcentaje_manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "CostCenter"
  ADD COLUMN IF NOT EXISTS "tipo"                    cost_center_type,
  ADD COLUMN IF NOT EXISTS "permite_imputacion"      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "responsableId"           uuid REFERENCES "User"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "baseDistribucion"        cost_distribution_base,
  ADD COLUMN IF NOT EXISTS "centroResponsableMinsal" varchar(40),
  ADD COLUMN IF NOT EXISTS "cuentaIngresoDefaultId"  uuid,
  ADD COLUMN IF NOT EXISTS "cuentaGastoDefaultId"    uuid;

-- Limpieza del seed previo (Wave 3.1 — code='GEN'). Safe: 0 InvoiceItem en BD.
DELETE FROM "CostCenter" WHERE code = 'GEN';

ALTER TABLE "CostCenter" ALTER COLUMN code TYPE varchar(11);
ALTER TABLE "CostCenter" DROP CONSTRAINT IF EXISTS cost_center_code_format_chk;
ALTER TABLE "CostCenter"
  ADD CONSTRAINT cost_center_code_format_chk
  CHECK (code ~ '^[1-3]-[A-Z]{3}-[A-Z]{3}$');

CREATE INDEX IF NOT EXISTS idx_cost_center_tipo ON "CostCenter" (tipo) WHERE tipo IS NOT NULL;

-- Reglas de prorrateo
CREATE TABLE IF NOT EXISTS "CostCenterAllocationRule" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"      uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  name                  varchar(120) NOT NULL,
  "sourceCostCenterId"  uuid NOT NULL REFERENCES "CostCenter"(id) ON DELETE CASCADE,
  base                  cost_distribution_base NOT NULL,
  periodicity           varchar(20) NOT NULL DEFAULT 'monthly',
  active                boolean NOT NULL DEFAULT true,
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("sourceCostCenterId", active) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS "CostCenterAllocationTarget" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ruleId"             uuid NOT NULL REFERENCES "CostCenterAllocationRule"(id) ON DELETE CASCADE,
  "targetCostCenterId" uuid NOT NULL REFERENCES "CostCenter"(id) ON DELETE RESTRICT,
  percentage           numeric(5,2) NOT NULL,
  CONSTRAINT alloc_target_pct_chk CHECK (percentage > 0 AND percentage <= 100)
);

CREATE INDEX IF NOT EXISTS idx_alloc_rule_org    ON "CostCenterAllocationRule" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_alloc_target_rule ON "CostCenterAllocationTarget" ("ruleId");

ALTER TABLE "CostCenterAllocationRule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alloc_rule_tenant ON "CostCenterAllocationRule";
CREATE POLICY alloc_rule_tenant ON "CostCenterAllocationRule"
  FOR ALL TO authenticated
  USING ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "CostCenterAllocationTarget" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alloc_target_tenant ON "CostCenterAllocationTarget";
CREATE POLICY alloc_target_tenant ON "CostCenterAllocationTarget"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "CostCenterAllocationRule" r
                 WHERE r.id = "CostCenterAllocationTarget"."ruleId"
                 AND r."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "CostCenterAllocationRule" r
                 WHERE r.id = "CostCenterAllocationTarget"."ruleId"
                 AND r."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid));

-- Trigger DEFERRABLE: suma de porcentajes por regla = 100% al final de transacción.
CREATE OR REPLACE FUNCTION fn_alloc_rule_targets_sum_100()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE
  v_rule_id uuid;
  v_total   numeric(7,2);
BEGIN
  v_rule_id := COALESCE(NEW."ruleId", OLD."ruleId");
  SELECT COALESCE(SUM(percentage), 0) INTO v_total
    FROM "CostCenterAllocationTarget" WHERE "ruleId" = v_rule_id;
  IF v_total > 0 AND ABS(v_total - 100.00) > 0.01 THEN
    RAISE EXCEPTION 'Suma de porcentajes de la regla debe ser 100%% (actual %)', v_total;
  END IF;
  RETURN NULL;
END $func$;

DROP TRIGGER IF EXISTS trg_alloc_rule_sum_100 ON "CostCenterAllocationTarget";
CREATE CONSTRAINT TRIGGER trg_alloc_rule_sum_100
  AFTER INSERT OR UPDATE OR DELETE ON "CostCenterAllocationTarget"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_alloc_rule_targets_sum_100();

-- Seed: 41 centros para Hospital Avante Central (única org con establecimiento).
-- Ver requerimientos-centros-costo-his.md §4 para la lista completa.
-- (Para otras orgs, el seed se ejecuta on-demand desde el UI Cost Centers.)
DO $$
DECLARE
  v_org uuid := 'c7eabf29-a484-4a69-9426-9ee8b06d054a'::uuid;
BEGIN
  INSERT INTO "CostCenter" ("organizationId", code, name, tipo, "permite_imputacion", "baseDistribucion")
  VALUES
    -- PRODUCTIVOS (15)
    (v_org, '1-CEX-GEN', 'Consulta externa general',                  'productivo', true, NULL),
    (v_org, '1-CEX-ESP', 'Consulta externa de especialidades',        'productivo', true, NULL),
    (v_org, '1-EMG-ADU', 'Emergencia adulto',                         'productivo', true, NULL),
    (v_org, '1-EMG-PED', 'Emergencia pediátrica',                     'productivo', true, NULL),
    (v_org, '1-HOS-MED', 'Hospitalización medicina interna',          'productivo', true, NULL),
    (v_org, '1-HOS-CIR', 'Hospitalización cirugía',                   'productivo', true, NULL),
    (v_org, '1-HOS-GIN', 'Hospitalización ginecología y obstetricia', 'productivo', true, NULL),
    (v_org, '1-HOS-PED', 'Hospitalización pediatría',                 'productivo', true, NULL),
    (v_org, '1-HOS-NEO', 'Neonatología',                              'productivo', true, NULL),
    (v_org, '1-UCI-ADU', 'UCI adulto',                                'productivo', true, NULL),
    (v_org, '1-UCI-PED', 'UCI pediátrica',                            'productivo', true, NULL),
    (v_org, '1-UCI-NEO', 'UCI neonatal',                              'productivo', true, NULL),
    (v_org, '1-QUI-MAY', 'Quirófano cirugía mayor',                   'productivo', true, NULL),
    (v_org, '1-QUI-MEN', 'Quirófano cirugía menor / ambulatoria',     'productivo', true, NULL),
    (v_org, '1-PAR-SAL', 'Sala de partos',                            'productivo', true, NULL),
    -- INTERMEDIOS (14)
    (v_org, '2-LAB-CLI', 'Laboratorio clínico',                       'intermedio', true, NULL),
    (v_org, '2-IMG-RAY', 'Rayos X',                                   'intermedio', true, NULL),
    (v_org, '2-IMG-USG', 'Ultrasonografía',                           'intermedio', true, NULL),
    (v_org, '2-IMG-TAC', 'Tomografía',                                'intermedio', true, NULL),
    (v_org, '2-IMG-RMN', 'Resonancia magnética',                      'intermedio', true, NULL),
    (v_org, '2-BSA-GEN', 'Banco de sangre',                           'intermedio', true, NULL),
    (v_org, '2-FAR-HOS', 'Farmacia hospitalaria',                     'intermedio', true, NULL),
    (v_org, '2-PAT-ANA', 'Anatomía patológica',                       'intermedio', true, NULL),
    (v_org, '2-END-GEN', 'Endoscopía',                                'intermedio', true, NULL),
    (v_org, '2-ANE-GEN', 'Anestesiología',                            'intermedio', true, NULL),
    (v_org, '2-REH-FIS', 'Rehabilitación y fisioterapia',             'intermedio', true, NULL),
    (v_org, '2-NUT-CLI', 'Nutrición clínica',                         'intermedio', true, NULL),
    (v_org, '2-CEY-GEN', 'Central de equipos y esterilización',       'intermedio', true, NULL),
    (v_org, '2-TSO-GEN', 'Trabajo social y psicología clínica',       'intermedio', true, NULL),
    -- APOYO (13) — con baseDistribucion default según especialidad
    (v_org, '3-DIR-GEN', 'Dirección y administración general',     'apoyo', true, 'numero_empleados'),
    (v_org, '3-RRH-GEN', 'Recursos humanos',                       'apoyo', true, 'numero_empleados'),
    (v_org, '3-FIN-CON', 'Contabilidad, finanzas y tesorería',     'apoyo', true, 'numero_empleados'),
    (v_org, '3-TIC-HIS', 'Tecnologías de información',             'apoyo', true, 'numero_empleados'),
    (v_org, '3-COM-ALM', 'Compras, almacén y suministros',         'apoyo', true, 'consumo_directo'),
    (v_org, '3-MAN-BIO', 'Mantenimiento biomédico',                'apoyo', true, 'consumo_directo'),
    (v_org, '3-MAN-GEN', 'Mantenimiento general e infraestructura','apoyo', true, 'metros_cuadrados'),
    (v_org, '3-LAV-GEN', 'Lavandería y ropería',                   'apoyo', true, 'kilos_lavados'),
    (v_org, '3-LIM-GEN', 'Aseo y limpieza',                        'apoyo', true, 'metros_cuadrados'),
    (v_org, '3-SEG-GEN', 'Seguridad y vigilancia',                 'apoyo', true, 'metros_cuadrados'),
    (v_org, '3-COC-ALI', 'Cocina y servicio de alimentación',      'apoyo', true, 'pacientes_atendidos'),
    (v_org, '3-TRA-AMB', 'Transporte y ambulancias',               'apoyo', true, 'pacientes_atendidos'),
    (v_org, '3-FAC-ADM', 'Facturación y admisión',                 'apoyo', true, 'numero_empleados')
  ON CONFLICT ("organizationId", code) DO NOTHING;
END $$;
