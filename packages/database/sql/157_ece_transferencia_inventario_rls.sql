-- =============================================================================
-- Migración 157: policy tenant-scoped en ece.transferencia_inventario (BD-P0-5)
-- Remedia: policy ALL USING (true) WITH CHECK (true) permite writes cross-tenant.
--
-- Diseño:
--   transferencia_inventario no tiene organization_id ni establecimiento_id directos.
--   La columna origen_gln contiene el GLN del almacén de origen, que comienza
--   con Organization.gs1CompanyPrefix de la organización propietaria.
--
--   Policy USING: origen_gln LIKE (gs1CompanyPrefix || '%')
--                 WHERE Organization.id = current_org_id()
--   Esto garantiza que solo se lean/escriban transferencias cuyo almacén de origen
--   pertenece al tenant activo.
--
-- DELETE: restringido adicionalmente a ADMIN (equivalente a inventory_threshold).
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE POLICY.
-- =============================================================================

-- Eliminar la policy permisiva existente
DROP POLICY IF EXISTS transferencia_inventario_authenticated_all ON ece.transferencia_inventario;

-- Garantizar RLS activa (puede estarlo ya si la policy previa existía)
ALTER TABLE ece.transferencia_inventario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transferencia_inventario_select_tenant ON ece.transferencia_inventario;
DROP POLICY IF EXISTS transferencia_inventario_insert_tenant ON ece.transferencia_inventario;
DROP POLICY IF EXISTS transferencia_inventario_update_tenant ON ece.transferencia_inventario;
DROP POLICY IF EXISTS transferencia_inventario_delete_tenant ON ece.transferencia_inventario;

-- Expresión de tenant reutilizada como subquery:
-- "el origen_gln empieza con el gs1CompanyPrefix de la org activa"
-- Se evalúa en tiempo de ejecución por el planner; STABLE y corta en NULL.

CREATE POLICY transferencia_inventario_select_tenant
  ON ece.transferencia_inventario
  FOR SELECT
  USING (
    current_org_id() IS NOT NULL
    AND origen_gln LIKE (
      (SELECT "gs1CompanyPrefix" FROM "Organization" WHERE id = current_org_id())
      || '%'
    )
  );

CREATE POLICY transferencia_inventario_insert_tenant
  ON ece.transferencia_inventario
  FOR INSERT
  WITH CHECK (
    current_org_id() IS NOT NULL
    AND origen_gln LIKE (
      (SELECT "gs1CompanyPrefix" FROM "Organization" WHERE id = current_org_id())
      || '%'
    )
  );

CREATE POLICY transferencia_inventario_update_tenant
  ON ece.transferencia_inventario
  FOR UPDATE
  USING (
    current_org_id() IS NOT NULL
    AND origen_gln LIKE (
      (SELECT "gs1CompanyPrefix" FROM "Organization" WHERE id = current_org_id())
      || '%'
    )
  )
  WITH CHECK (
    current_org_id() IS NOT NULL
    AND origen_gln LIKE (
      (SELECT "gs1CompanyPrefix" FROM "Organization" WHERE id = current_org_id())
      || '%'
    )
  );

-- DELETE: requiere adicionalmente rol ADMIN (consistente con inventory_threshold)
CREATE POLICY transferencia_inventario_delete_tenant
  ON ece.transferencia_inventario
  FOR DELETE
  USING (
    current_org_id() IS NOT NULL
    AND origen_gln LIKE (
      (SELECT "gs1CompanyPrefix" FROM "Organization" WHERE id = current_org_id())
      || '%'
    )
    AND EXISTS (
      SELECT 1
      FROM "UserOrganizationRole" uor
      JOIN "Role" r ON r.id = uor."roleId"
      WHERE uor."userId"         = current_user_id()
        AND uor."organizationId" = current_org_id()
        AND r.code               = 'ADMIN'
        AND r.active             = true
        AND (uor."validTo" IS NULL OR uor."validTo" > now())
    )
  );
