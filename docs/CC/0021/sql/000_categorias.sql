-- =============================================================================
-- 000_categorias.sql (emitido por sync-tarifario-odoo.mjs --emit-sql)
-- CC-0021 — 14 categorías de servicio × org real.
-- Requiere sql/204_cc0021_motor_reglas_precios.sql aplicado y las listas
-- "ODOO — {nombre}" ya creadas (CC-0015, 000_listas.sql).
-- Idempotente: reejecutable sin duplicar filas.
-- =============================================================================

INSERT INTO "ServiceCategory" ("organizationId", code, nombre, "odooCategId")
SELECT o.id, v.code, v.nombre, v.odoo_id
FROM "Organization" o
CROSS JOIN (VALUES
    (1, 'I', 'I', NULL),
    (166, 'ALIMENTACION', 'ALIMENTACION', NULL),
    (169, 'CAFETERIA', 'CAFETERIA', NULL),
    (170, 'HEMODERIVADOS', 'HEMODERIVADOS', NULL),
    (171, 'IMAGENES', 'IMAGENES', NULL),
    (172, 'INSUMOS', 'INSUMOS', NULL),
    (174, 'LABORATORIO', 'LABORATORIO', NULL),
    (175, 'MEDICAMENTOS', 'MEDICAMENTOS', NULL),
    (176, 'MEDICAMENTOS_CONTROLADOS', 'MEDICAMENTOS CONTROLADOS', NULL),
    (179, 'SERVICIOS_HOSPITALARIOS', 'SERVICIOS HOSPITALARIOS', NULL),
    (181, 'TERAPIA_RESPIRATORIA', 'TERAPIA RESPIRATORIA', NULL),
    (182, 'USOS_Y_EQUIPOS', 'USOS Y EQUIPOS', NULL),
    (187, 'MISCELANEOS', 'MISCELANEOS', NULL),
    (190, 'SERVICIOS_DR_SV', 'Servicios DR SV', NULL)
) AS v(odoo_id, code, nombre, parent_odoo_id)
WHERE o."legalName" NOT LIKE 'RLS-Test%'
  AND NOT EXISTS (
    SELECT 1 FROM "ServiceCategory" sc
     WHERE sc."organizationId" = o.id AND sc.code = v.code
  );

-- Segunda pasada: enlaza el árbol (padre dentro de la misma org).
UPDATE "ServiceCategory" hija
   SET "parentId" = padre.id, "updatedAt" = now()
  FROM (VALUES
    (1, 'I', 'I', NULL),
    (166, 'ALIMENTACION', 'ALIMENTACION', NULL),
    (169, 'CAFETERIA', 'CAFETERIA', NULL),
    (170, 'HEMODERIVADOS', 'HEMODERIVADOS', NULL),
    (171, 'IMAGENES', 'IMAGENES', NULL),
    (172, 'INSUMOS', 'INSUMOS', NULL),
    (174, 'LABORATORIO', 'LABORATORIO', NULL),
    (175, 'MEDICAMENTOS', 'MEDICAMENTOS', NULL),
    (176, 'MEDICAMENTOS_CONTROLADOS', 'MEDICAMENTOS CONTROLADOS', NULL),
    (179, 'SERVICIOS_HOSPITALARIOS', 'SERVICIOS HOSPITALARIOS', NULL),
    (181, 'TERAPIA_RESPIRATORIA', 'TERAPIA RESPIRATORIA', NULL),
    (182, 'USOS_Y_EQUIPOS', 'USOS Y EQUIPOS', NULL),
    (187, 'MISCELANEOS', 'MISCELANEOS', NULL),
    (190, 'SERVICIOS_DR_SV', 'Servicios DR SV', NULL)
  ) AS v(odoo_id, code, nombre, parent_odoo_id)
  JOIN "ServiceCategory" padre ON padre."odooCategId" = v.parent_odoo_id
 WHERE hija."odooCategId" = v.odoo_id
   AND hija."organizationId" = padre."organizationId"
   AND v.parent_odoo_id IS NOT NULL
   AND hija."parentId" IS DISTINCT FROM padre.id;
