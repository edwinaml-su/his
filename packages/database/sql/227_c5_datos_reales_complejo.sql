-- 227 — C5-1 (docs/48 Ola 5): datos reales del Complejo Hospitalario Avante
-- APLICADO a prod 2026-09-10 vía MCP — NO re-aplicar.
--
-- Fuente: tarjeta IVA Ministerio de Hacienda (NIT/NRC únicos para todo el
-- complejo — una sola entidad fiscal) + estructura operativa leída de Odoo
-- (res.company 1/2/3, stock.warehouse WHC/WHE/WHUS).
--
-- Modelo resultante: 1 Organization fiscal (INVERSIONES AVANTE, S.A. DE C.V.)
-- con 3 Establishments operativos (HE / CM / US). La restricción
-- Organization_countryId_taxId_key (UNIQUE countryId+taxId) exige este modelo:
-- un NIT = una Organization. Las 2 orgs placeholder del seed original
-- (Avante Holding, Clínica Avante SM — NITs inventados) quedan inactivas.

BEGIN;

-- 0) Fix del bridge ADR 0022 (SQL 221): 'hospitalario' viola el CHECK
--    establecimiento_nivel_atencion_check (primer|segundo|tercer). Defecto
--    latente — nunca disparó porque no se insertó ningún Establishment desde
--    que existe el trigger. Default 'tercer' (igual que la fila existente).
CREATE OR REPLACE FUNCTION ece.fn_establishment_bridge_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ece', 'public', 'pg_catalog'
AS $function$
DECLARE
  v_institucion uuid;
BEGIN
  SELECT id INTO v_institucion
  FROM ece.institucion WHERE organization_id = NEW."organizationId" LIMIT 1;

  IF v_institucion IS NULL THEN
    INSERT INTO ece.institucion (id, codigo, nombre, tipo, organization_id)
    VALUES (gen_random_uuid(), 'INST-' || left(NEW."organizationId"::text, 8),
            'Institución ' || NEW.name, 'privado', NEW."organizationId")
    RETURNING id INTO v_institucion;
  END IF;

  INSERT INTO ece.establecimiento (id, institucion_id, codigo, nombre, nivel_atencion, establishment_id)
  SELECT gen_random_uuid(), v_institucion, 'EST-' || left(NEW.id::text, 8),
         NEW.name, 'tercer', NEW.id
  WHERE NOT EXISTS (
    SELECT 1 FROM ece.establecimiento e WHERE e.establishment_id = NEW.id);

  RETURN NEW;
END;
$function$;

-- 1) NRC (Nº de Registro de Contribuyente, Ministerio de Hacienda SV).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "nrc" VARCHAR(20);
COMMENT ON COLUMN "Organization"."nrc" IS 'Número de Registro de Contribuyente (NRC) — Ministerio de Hacienda, El Salvador. Único por entidad fiscal, compartido por todos sus establecimientos.';

-- 2) La org operativa (dueña de pacientes/cuentas/catálogos) pasa a ser la
--    entidad fiscal real del complejo.
UPDATE "Organization" SET
  "legalName" = 'INVERSIONES AVANTE, SOCIEDAD ANONIMA DE CAPITAL VARIABLE',
  "tradeName" = 'Complejo Hospitalario Avante',
  "taxId"     = '0614-230219-101-9',
  "nrc"       = '277720-3',
  "parentId"  = NULL,
  "updatedAt" = now()
WHERE id = 'c7eabf29-a484-4a69-9426-9ee8b06d054a';

-- 3) Placeholders del seed original: inactivas (no se borran — poseen copias
--    de catálogos y filas de auditoría).
UPDATE "Organization" SET active = false, "updatedAt" = now()
WHERE id IN ('af0d8a72-7532-41a9-a0b0-b58cf78bd78b',  -- "Avante Holding" (NIT ficticio 0614-010101-001-1)
             '2922715b-956a-4c79-9625-9690966293d5'); -- "Clínica Avante San Miguel" (NIT ficticio 0614-030303-003-3)

-- 4) HE — el establecimiento existente (EST-001) es la sede hospitalaria real.
UPDATE "Establishment" SET
  code          = 'HE',
  name          = 'AVANTE HOSPITAL ESPECIALIZADO',
  "addressLine" = 'Paseo General Escalón #4920, Colonia Escalón, 3ª Calle Poniente, San Salvador',
  phone         = '2238-2300',
  "updatedAt"   = now()
WHERE id = '68c496a8-5755-4e90-ab45-a872c36f9ce1';

-- 5) CM (casa matriz) y US — nuevos establecimientos de la misma org.
INSERT INTO "Establishment"
  (id, "organizationId", code, name, "addressLine", phone, active, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'c7eabf29-a484-4a69-9426-9ee8b06d054a', 'CM',
   'AVANTE CENTRO MEDICO ESPECIALIZADO',
   '1ª Calle Poniente #3844, Colonia Escalón, San Salvador', '2238-2300', true, now(), now()),
  (gen_random_uuid(), 'c7eabf29-a484-4a69-9426-9ee8b06d054a', 'US',
   'UNIDAD SATELITAL SURFCITY',
   'Centro Comercial The Point, San Blas, La Libertad Costa, La Libertad', '2238-2300', true, now(), now())
ON CONFLICT ("organizationId", code) DO NOTHING;

COMMIT;

-- Verificación:
--   SELECT "legalName","taxId","nrc",active FROM "Organization" WHERE "legalName" NOT LIKE 'RLS-Test%';
--   SELECT code,name,active FROM "Establishment" ORDER BY code;  -- CM / HE / US
