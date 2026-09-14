-- =============================================================================
-- 236_cc0029_giai_activos_biomedicos.sql
-- CC-0029 — GIAI operativo en equipos biomédicos (gestión de activos GS1).
--
-- Diagnóstico (@Orq, verificado por @Dev vía MCP execute_sql 2026-09-14):
-- `public."BiomedicalEquipment"` tenía columnas DUPLICADAS — dos migraciones
-- distintas crearon el mismo concepto:
--   • "giaiCode" (camelCase, sin CHECK de formato) Y giai_code (snake_case,
--     CHECK 18 dígitos — sql/82_equipment_gs1_extension.sql).
--   • "glnUbicacionActual" (camelCase, FK NOT DEFERRABLE) Y
--     gln_ubicacion_actual (snake_case, FK DEFERRABLE — sql/82).
-- La columna camelCase quoted NO tiene sql/ que la haya creado en este repo
-- (drift de una sesión anterior que aplicó `prisma db push`/ALTER directo sin
-- dejar archivo numerado — ver docs/45_registro_drift_schema.md). Verificado
-- 2026-09-14: 0 filas en `BiomedicalEquipment` (tabla vacía en prod), así que
-- consolidar es gratis — no hay migración de datos.
--
-- Decisión: columna canónica = camelCase quoted ("giaiCode",
-- "glnUbicacionActual") — convención Prisma del resto de la tabla (todas sus
-- columnas van camelCase quoted: "organizationId", "establishmentId", etc.).
-- Se DROPEAN las snake_case (cascada automática de sus constraints/índices —
-- uq_biomedequip_giai_code, chk_biomedequip_giai_digits,
-- idx_biomedequip_giai_code, fk_biomedequip_gln, idx_biomedequip_gln_ubicacion
-- desaparecen con la columna, no hace falta DROP CONSTRAINT explícito).
--
-- La camelCase sobreviviente queda incompleta respecto al patrón GS1 del
-- repo — se completa aquí:
--   a) "giaiCode": agrega el CHECK de formato que nunca tuvo. El GIAI real
--      (AI 8004) NO es de 18 dígitos fijos como el drift original asumía —
--      es prefijo GS1 de empresa (7-12 dígitos) + referencia de activo
--      alfanumérica, total ≤30 caracteres, SIN dígito verificador (GS1
--      General Specifications §8004). Mismo regex que
--      packages/contracts/src/validators/gs1.ts#validateGIAI (paridad TS↔SQL).
--      El UNIQUE ya existente (BiomedicalEquipment_giaiCode_key) ya cumple
--      "un GIAI = un activo" (NULLs no colisionan en Postgres) — no se toca.
--   b) "glnUbicacionActual": su FK (BiomedicalEquipment_glnUbicacionActual_fkey)
--      no era DEFERRABLE — se recrea DEFERRABLE INITIALLY DEFERRED, mismo
--      patrón que sql/82 y sql/199, para permitir alta de equipo + GLN en la
--      misma transacción sin ordenar inserts. El índice parcial
--      idx_biomedical_equipment_gln ya existe y es correcto — no se toca.
--
-- APLICADO a prod 2026-09-14 vía MCP por @Orq (el agente paró antes de aplicar;
-- verificado post-apply: solo giaiCode/glnUbicacionActual, chk_biomedequip_giai_format
-- presente, FK deferrable). Idempotente: DROP COLUMN IF EXISTS, DROP CONSTRAINT IF EXISTS + ADD
-- CONSTRAINT guardado con DO $$ (evita error si ya se corrió antes).
-- APLICADO a prod 2026-09-14 vía MCP (proyecto ejacvsgbewcerxtjtwto) — NO re-aplicar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) Elimina las columnas snake_case duplicadas (0 filas — sin migración de
--    datos). DROP COLUMN arrastra en cascada sus constraints e índices.
-- -----------------------------------------------------------------------------

ALTER TABLE public."BiomedicalEquipment"
  DROP COLUMN IF EXISTS giai_code,
  DROP COLUMN IF EXISTS gln_ubicacion_actual;

-- -----------------------------------------------------------------------------
-- b) "giaiCode" — agrega el CHECK de formato GIAI (AI 8004) que le faltaba.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_biomedequip_giai_format'
       AND conrelid = 'public."BiomedicalEquipment"'::regclass
  ) THEN
    ALTER TABLE public."BiomedicalEquipment"
      ADD CONSTRAINT chk_biomedequip_giai_format
        CHECK (
          "giaiCode" IS NULL
          OR (
            "giaiCode" ~ '^[0-9]{7,12}[A-Za-z0-9]{1,23}$'
            AND length("giaiCode") <= 30
          )
        );
  END IF;
END $$;

COMMENT ON COLUMN public."BiomedicalEquipment"."giaiCode" IS
  'GS1 Global Individual Asset Identifier (GIAI, AI 8004). Prefijo GS1 de '
  'empresa (7-12 dígitos) + referencia de activo alfanumérica, ≤30 '
  'caracteres. Sin dígito verificador (GS1 no lo exige para GIAI). '
  'CC-0029 — columna canónica (consolida drift con giai_code, dropeada aquí).';

-- -----------------------------------------------------------------------------
-- c) "glnUbicacionActual" — recrea el FK como DEFERRABLE INITIALLY DEFERRED
--    (patrón sql/82 / sql/199). Postgres no permite ALTER de deferrability
--    in-place: hay que dropear y re-crear el constraint.
-- -----------------------------------------------------------------------------

ALTER TABLE public."BiomedicalEquipment"
  DROP CONSTRAINT IF EXISTS "BiomedicalEquipment_glnUbicacionActual_fkey";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_biomedequip_gln_ubicacion_actual'
       AND conrelid = 'public."BiomedicalEquipment"'::regclass
  ) THEN
    ALTER TABLE public."BiomedicalEquipment"
      ADD CONSTRAINT fk_biomedequip_gln_ubicacion_actual
        FOREIGN KEY ("glnUbicacionActual") REFERENCES ece.gs1_gln(codigo)
        DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

COMMENT ON COLUMN public."BiomedicalEquipment"."glnUbicacionActual" IS
  'GLN (GS1 Global Location Number) de la ubicación física actual del '
  'activo. Se actualiza en cada evento EPCIS registrado por '
  'actualizarUbicacion. CC-0029 — columna canónica (consolida drift con '
  'gln_ubicacion_actual, dropeada aquí); FK ahora DEFERRABLE INITIALLY DEFERRED.';
