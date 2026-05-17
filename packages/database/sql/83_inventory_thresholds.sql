-- =============================================================================
-- HIS SQL 83 — Inventory Thresholds GS1
--
-- Tabla ece.inventory_threshold: umbrales de stock por GTIN (GS1) y GLN (ubicación).
-- Alimenta las alertas stock_bajo | stock_critico | proximo_vencer | vencido
-- del router inventory.gs1.configurarThreshold y inventory.gs1.listAlertas.
--
-- RLS Cat-E: INSERT/UPDATE solo INVENTORY_MANAGER + ADMIN; SELECT cualquier
-- authenticated del mismo org.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS.
-- Aplicar vía mcp__supabase__apply_migration.
-- =============================================================================

-- Verificar que existen las tablas referenciadas
-- ece.gs1_gtin y ece.gs1_gln deben existir (SQL 56_ece_01_catalogos.sql)

CREATE TABLE IF NOT EXISTS ece.inventory_threshold (
  -- PK compuesta: UUID del GTIN + código del GLN (PKs reales de las tablas GS1)
  gtin_id               uuid        NOT NULL
                          REFERENCES ece.gs1_gtin(id)       ON DELETE CASCADE,
  ubicacion_gln         text        NOT NULL
                          REFERENCES ece.gs1_gln(codigo)    ON DELETE CASCADE,
  organization_id       uuid        NOT NULL
                          REFERENCES public."Organization"(id) ON DELETE CASCADE,
  stock_minimo          integer     NOT NULL CHECK (stock_minimo >= 0),
  stock_critico         integer     NOT NULL CHECK (stock_critico >= 0),
  reorder_point         integer     NOT NULL CHECK (reorder_point >= 0),
  dias_caducidad_alerta integer     NOT NULL DEFAULT 30
                          CHECK (dias_caducidad_alerta > 0),
  configurado_por       uuid        NOT NULL REFERENCES auth.users(id),
  configurado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (gtin_id, ubicacion_gln),

  -- stock_critico <= stock_minimo es la regla de negocio habitual
  CONSTRAINT threshold_critico_le_minimo
    CHECK (stock_critico <= stock_minimo)
);

COMMENT ON TABLE ece.inventory_threshold IS
  'Umbrales de inventario GS1 por GTIN + GLN. Alimenta alertas de stock '
  'bajo/crítico y caducidad. RLS Cat-E: write = INVENTORY_MANAGER|ADMIN.';

COMMENT ON COLUMN ece.inventory_threshold.gtin_id IS
  'UUID FK a ece.gs1_gtin(id) — Global Trade Item Number GS1.';
COMMENT ON COLUMN ece.inventory_threshold.ubicacion_gln IS
  'Código FK a ece.gs1_gln(codigo) — Global Location Number GS1.';
COMMENT ON COLUMN ece.inventory_threshold.stock_minimo IS
  'Nivel mínimo de stock. Bajo este nivel se emite alerta stock_bajo.';
COMMENT ON COLUMN ece.inventory_threshold.stock_critico IS
  'Nivel crítico. Bajo este nivel se emite alerta stock_critico (mayor severidad).';
COMMENT ON COLUMN ece.inventory_threshold.reorder_point IS
  'Punto de reorden. Al llegar aquí se sugiere generar orden de compra.';
COMMENT ON COLUMN ece.inventory_threshold.dias_caducidad_alerta IS
  'Días antes de vencimiento para emitir alerta proximo_vencer (default 30).';

-- Índice para queries por organización
CREATE INDEX IF NOT EXISTS idx_inv_threshold_org
  ON ece.inventory_threshold (organization_id);

-- Trigger para actualizar actualizado_en
CREATE OR REPLACE FUNCTION ece.fn_threshold_set_actualizado_en()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_threshold_actualizado_en ON ece.inventory_threshold;
CREATE TRIGGER trg_inv_threshold_actualizado_en
  BEFORE UPDATE ON ece.inventory_threshold
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_threshold_set_actualizado_en();

-- =============================================================================
-- RLS Cat-E
-- =============================================================================

ALTER TABLE ece.inventory_threshold ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.inventory_threshold FORCE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado del mismo org
DROP POLICY IF EXISTS inv_threshold_select ON ece.inventory_threshold;
CREATE POLICY inv_threshold_select
  ON ece.inventory_threshold
  FOR SELECT
  TO authenticated
  USING (organization_id = current_org_id());

-- INSERT: solo roles privilegiados del org
-- Modelo: UserOrganizationRole → Role (code)
DROP POLICY IF EXISTS inv_threshold_insert ON ece.inventory_threshold;
CREATE POLICY inv_threshold_insert
  ON ece.inventory_threshold
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = current_org_id()
    AND EXISTS (
      SELECT 1
        FROM public."UserOrganizationRole" uor
        JOIN public."Role" r ON r.id = uor."roleId"
       WHERE uor."userId"         = current_user_id()
         AND uor."organizationId" = current_org_id()
         AND r.code               IN ('ADMIN', 'INVENTORY_MANAGER')
         AND r.active             = true
         AND (uor."validTo" IS NULL OR uor."validTo" > now())
    )
  );

-- UPDATE: mismas restricciones que INSERT
DROP POLICY IF EXISTS inv_threshold_update ON ece.inventory_threshold;
CREATE POLICY inv_threshold_update
  ON ece.inventory_threshold
  FOR UPDATE
  TO authenticated
  USING (organization_id = current_org_id())
  WITH CHECK (
    organization_id = current_org_id()
    AND EXISTS (
      SELECT 1
        FROM public."UserOrganizationRole" uor
        JOIN public."Role" r ON r.id = uor."roleId"
       WHERE uor."userId"         = current_user_id()
         AND uor."organizationId" = current_org_id()
         AND r.code               IN ('ADMIN', 'INVENTORY_MANAGER')
         AND r.active             = true
         AND (uor."validTo" IS NULL OR uor."validTo" > now())
    )
  );

-- DELETE: solo ADMIN
DROP POLICY IF EXISTS inv_threshold_delete ON ece.inventory_threshold;
CREATE POLICY inv_threshold_delete
  ON ece.inventory_threshold
  FOR DELETE
  TO authenticated
  USING (
    organization_id = current_org_id()
    AND EXISTS (
      SELECT 1
        FROM public."UserOrganizationRole" uor
        JOIN public."Role" r ON r.id = uor."roleId"
       WHERE uor."userId"         = current_user_id()
         AND uor."organizationId" = current_org_id()
         AND r.code               = 'ADMIN'
         AND r.active             = true
         AND (uor."validTo" IS NULL OR uor."validTo" > now())
    )
  );

-- service_role bypasea RLS por default (necesario para el batch job).

-- =============================================================================
-- Verificación post-apply
-- =============================================================================
-- SELECT count(*) FROM pg_policies
--   WHERE schemaname = 'ece' AND tablename = 'inventory_threshold';
-- Esperado: 4
--
-- SELECT relrowsecurity, relforcerowsecurity
--   FROM pg_class
--   WHERE relname = 'inventory_threshold' AND relnamespace = 'ece'::regnamespace;
-- Esperado: ambos true
-- =============================================================================
