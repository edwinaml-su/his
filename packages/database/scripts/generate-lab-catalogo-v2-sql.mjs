#!/usr/bin/env node
/**
 * Genera packages/database/sql/219_lab_catalogo_v2_seed.sql a partir de
 * packages/database/seed/catalogo_laboratorio_v2.json (rediseño lab 2026-09,
 * design/mockup/mockup_examenes_laboratorio.html).
 *
 * Diseño del seed (idempotente, org-genérico — corre para TODAS las
 * organizaciones existentes vía CROSS JOIN, y puede re-correrse):
 *   1. LabSampleType / LabSampleSubtype: insert-si-falta + update de orden.
 *   2. Secciones = LabPanel (area LABORATORIO): insert-si-falta por nombre
 *      (código determinista SECLB-NN, ≤20 chars).
 *   3. Pruebas = LabTest: si existe (org, panel-sección, nombre) se ACTUALIZA
 *      sampleType/sampleSubtype/defaultQty y se reactiva; si falta se crea con
 *      código LABV2-NNN. Las PORT-%/LABV2-% que ya no estén en el JSON se
 *      desactivan (active=false) — los tests creados a mano por el tenant no
 *      se tocan.
 *   4. Los "parametros" del JSON vienen en clave Tipo|||Subtipo (no resuelven
 *      a una prueba) — NO se cargan; los parámetros por prueba se administran
 *      desde Mantenimiento (LabTestParameter).
 *
 * Uso: node packages/database/scripts/generate-lab-catalogo-v2-sql.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = JSON.parse(readFileSync(join(root, "seed", "catalogo_laboratorio_v2.json"), "utf8"));

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const tipoRows = db.tipos.map((t, i) => `(${q(t)}, ${i})`).join(",\n    ");

const subRows = [];
for (const [tipo, subs] of Object.entries(db.subtipos)) {
  subs.forEach((su, i) => subRows.push(`(${q(tipo)}, ${q(su)}, ${i})`));
}

const secRows = db.secciones.map((s, i) => `(${q(s)}, 'SECLB-${String(i + 1).padStart(2, "0")}', ${i})`).join(",\n    ");

const testRows = db.pruebas
  .map((p, i) => `(${q(p.seccion)}, ${q(p.prueba)}, ${q(p.tipo)}, ${q(p.subtipo)}, ${p.cant || 1}, 'LABV2-${String(i + 1).padStart(3, "0")}', ${i})`)
  .join(",\n    ");

const sql = `-- =============================================================================
-- 219_lab_catalogo_v2_seed.sql — GENERADO por
-- packages/database/scripts/generate-lab-catalogo-v2-sql.mjs a partir de
-- packages/database/seed/catalogo_laboratorio_v2.json. NO editar a mano:
-- regenerar con \`node packages/database/scripts/generate-lab-catalogo-v2-sql.mjs\`.
--
-- Catálogo inicial del rediseño de laboratorio (mockup 2026-09):
-- ${db.secciones.length} secciones · ${db.tipos.length} tipos · ${subRows.length} subtipos · ${db.pruebas.length} pruebas.
-- Idempotente y org-genérico (corre para todas las organizaciones).
-- Requiere sql/218 aplicado.
-- =============================================================================

-- 1. Tipos de muestra ---------------------------------------------------------
WITH orgs AS (SELECT id FROM public."Organization"),
v(name, ord) AS (VALUES
    ${tipoRows}
)
INSERT INTO public."LabSampleType" ("organizationId", name, "displayOrder", active)
SELECT o.id, v.name, v.ord, true FROM orgs o CROSS JOIN v
ON CONFLICT ("organizationId", name)
DO UPDATE SET "displayOrder" = EXCLUDED."displayOrder", active = true;

-- 2. Subtipos de muestra ------------------------------------------------------
WITH v(tipo, name, ord) AS (VALUES
    ${subRows.join(",\n    ")}
)
INSERT INTO public."LabSampleSubtype" ("organizationId", "sampleTypeId", name, "displayOrder", active)
SELECT st."organizationId", st.id, v.name, v.ord, true
FROM v JOIN public."LabSampleType" st ON st.name = v.tipo AND st."organizationId" IS NOT NULL
ON CONFLICT ("sampleTypeId", name)
DO UPDATE SET "displayOrder" = EXCLUDED."displayOrder", active = true;

-- 3. Secciones (LabPanel, area LABORATORIO) -----------------------------------
WITH orgs AS (SELECT id FROM public."Organization"),
v(name, code, ord) AS (VALUES
    ${secRows}
)
INSERT INTO public."LabPanel" (id, "organizationId", code, name, area, "displayOrder", active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, v.code, v.name, 'LABORATORIO', v.ord, true, now(), now()
FROM orgs o CROSS JOIN v
WHERE NOT EXISTS (
  SELECT 1 FROM public."LabPanel" p
  WHERE p."organizationId" = o.id AND upper(p.name) = upper(v.name) AND p.area = 'LABORATORIO');

UPDATE public."LabPanel" p SET "displayOrder" = v.ord, active = true, "updatedAt" = now()
FROM (VALUES
    ${secRows}
) AS v(name, code, ord)
WHERE p."organizationId" IS NOT NULL AND p.area = 'LABORATORIO' AND upper(p.name) = upper(v.name);

-- 4. Pruebas (LabTest) --------------------------------------------------------
-- 4a. Actualizar existentes (match por org + sección + nombre, case-insensitive).
WITH v(seccion, prueba, tipo, subtipo, cant, code, ord) AS (VALUES
    ${testRows}
)
UPDATE public."LabTest" t SET
  "sampleTypeId"    = st.id,
  "sampleSubtypeId" = ss.id,
  "defaultQty"      = v.cant,
  "displayOrder"    = v.ord,
  active            = true,
  "updatedAt"       = now()
FROM v
JOIN public."LabPanel" p  ON p.area = 'LABORATORIO' AND upper(p.name) = upper(v.seccion)
JOIN public."LabSampleType" st ON st.name = v.tipo AND st."organizationId" = p."organizationId"
LEFT JOIN public."LabSampleSubtype" ss ON ss."sampleTypeId" = st.id AND ss.name = v.subtipo
WHERE t."panelId" = p.id AND t."organizationId" = p."organizationId"
  AND upper(t.name) = upper(v.prueba);

-- 4b. Insertar faltantes.
WITH v(seccion, prueba, tipo, subtipo, cant, code, ord) AS (VALUES
    ${testRows}
)
INSERT INTO public."LabTest" (id, "organizationId", "panelId", code, name, specimen,
  "sampleTypeId", "sampleSubtypeId", "defaultQty", "displayOrder", active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), p."organizationId", p.id, v.code, v.prueba, 'OTHER',
  st.id, ss.id, v.cant, v.ord, true, now(), now()
FROM v
JOIN public."LabPanel" p  ON p.area = 'LABORATORIO' AND upper(p.name) = upper(v.seccion) AND p."organizationId" IS NOT NULL
JOIN public."LabSampleType" st ON st.name = v.tipo AND st."organizationId" = p."organizationId"
LEFT JOIN public."LabSampleSubtype" ss ON ss."sampleTypeId" = st.id AND ss.name = v.subtipo
WHERE NOT EXISTS (
  SELECT 1 FROM public."LabTest" t
  WHERE t."panelId" = p.id AND t."organizationId" = p."organizationId"
    AND upper(t.name) = upper(v.prueba));

-- 4c. Desactivar pruebas del portafolio sembrado que ya no están en el JSON.
WITH v(seccion, prueba, tipo, subtipo, cant, code, ord) AS (VALUES
    ${testRows}
)
UPDATE public."LabTest" t SET active = false, "updatedAt" = now()
FROM public."LabPanel" p
WHERE t."panelId" = p.id AND p.area = 'LABORATORIO'
  AND t."organizationId" IS NOT NULL
  AND (t.code LIKE 'PORT-%' OR t.code LIKE 'LABV2-%')
  AND t.active = true
  AND NOT EXISTS (
    SELECT 1 FROM v
    WHERE upper(v.seccion) = upper(p.name) AND upper(v.prueba) = upper(t.name));
`;

const out = join(root, "sql", "219_lab_catalogo_v2_seed.sql");
writeFileSync(out, sql);
console.log("OK →", out, `(${db.pruebas.length} pruebas)`);
