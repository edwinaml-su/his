-- =============================================================================
-- 212_cc0026_service_unit_area.sql
-- CC-0026 D3 — ServiceUnit.areaType + seed de unidades SALA_ESPERA/MAX_URG.
--
-- Los tableros `/tableros/[unidad]` (Ola 3) agrupan CareTask por área
-- funcional. Hoy `ServiceUnit` no tiene esa clasificación (solo `code`/`name`
-- libres) y las áreas "Sala de Espera" y "Máxima Urgencia" que pide el
-- mockup no existen (0 grep en sql/ ni en seed.ts al 2026-08-26).
--
-- Ver docs/CC/0026/REQ-CC-0026-indicacion-tareas-tableros.md — decisión D3.
--
-- Patrón de columna nueva + backfill + índice: replica sql/199 (ServiceUnit.glnCodigo).
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- NO aplicado a prod por este archivo — pendiente de review de @Orq.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columna + CHECK (vocabulario cerrado, patrón varchar+CHECK del resto de
--    la BD — ver comentario de sql/209 sobre por qué no se usa enum Postgres).
-- -----------------------------------------------------------------------------
ALTER TABLE public."ServiceUnit"
  ADD COLUMN IF NOT EXISTS "areaType" varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_serviceunit_area_type'
  ) THEN
    ALTER TABLE public."ServiceUnit"
      ADD CONSTRAINT chk_serviceunit_area_type CHECK (
        "areaType" IS NULL OR "areaType" IN (
          'QUIROFANO', 'LABORATORIO', 'IMAGENES', 'EMERGENCIA', 'UCI', 'UCIN',
          'MAX_URGENCIA', 'SALA_ESPERA', 'HOSPITALIZACION', 'CONSULTA',
          'FARMACIA', 'PARTOS', 'OTRA'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public."ServiceUnit"."areaType" IS
  'CC-0026 D3 — clasificación funcional para agrupar tableros de seguimiento '
  '(/tableros/[unidad]). Nullable: unidades sin tablero propio (ej. consulta '
  'externa sin CareTask) quedan sin clasificar. Vocabulario cerrado por CHECK, '
  'no enum Postgres (consistente con CareTask.status/priority, sql/209).';

-- -----------------------------------------------------------------------------
-- 2. Backfill por código del seed actual (idempotente — solo toca filas cuyo
--    areaType siga NULL, así no pisa overrides manuales posteriores).
-- -----------------------------------------------------------------------------
-- ⚠️ APLICADO A PROD 2026-08-26 en DOS migraciones (212a DDL / 212b DML):
-- CREATE INDEX no puede correr en la misma tx que UPDATE/INSERT sobre la
-- tabla (los triggers de auditoría dejan pending trigger events → error
-- 55006). Por eso el índice va ANTES del DML en este archivo. Misma clase
-- de lección que ALTER TYPE + CREATE INDEX (30a/30b).
CREATE INDEX IF NOT EXISTS idx_serviceunit_area_type ON public."ServiceUnit" ("establishmentId", "areaType") WHERE "areaType" IS NOT NULL;

UPDATE public."ServiceUnit" SET "areaType" = 'QUIROFANO'       WHERE code = 'QX'     AND "areaType" IS NULL;
UPDATE public."ServiceUnit" SET "areaType" = 'LABORATORIO'     WHERE code = 'LAB'    AND "areaType" IS NULL;
UPDATE public."ServiceUnit" SET "areaType" = 'IMAGENES'        WHERE code = 'RX'     AND "areaType" IS NULL;
UPDATE public."ServiceUnit" SET "areaType" = 'EMERGENCIA'      WHERE code = 'ER'     AND "areaType" IS NULL;
UPDATE public."ServiceUnit" SET "areaType" = 'UCI'             WHERE code = 'UCI'    AND "areaType" IS NULL;
UPDATE public."ServiceUnit" SET "areaType" = 'UCIN'            WHERE code = 'UCIN'   AND "areaType" IS NULL;
UPDATE public."ServiceUnit" SET "areaType" = 'HOSPITALIZACION' WHERE code = 'HOSP'   AND "areaType" IS NULL;
UPDATE public."ServiceUnit" SET "areaType" = 'CONSULTA'        WHERE code = 'CE'     AND "areaType" IS NULL;
UPDATE public."ServiceUnit" SET "areaType" = 'FARMACIA'        WHERE code = 'FAR'    AND "areaType" IS NULL;
UPDATE public."ServiceUnit" SET "areaType" = 'PARTOS'          WHERE code = 'PARTOS' AND "areaType" IS NULL;

-- -----------------------------------------------------------------------------
-- 3. Seed de 2 unidades nuevas por cada establecimiento activo (idempotente
--    vía NOT EXISTS — no hay UNIQUE(establishmentId, code) declarado a nivel
--    SQL para hacer ON CONFLICT, así que se verifica explícito).
-- -----------------------------------------------------------------------------
INSERT INTO public."ServiceUnit" (id, "organizationId", "establishmentId", code, name, active, "areaType", "createdAt", "updatedAt")
SELECT gen_random_uuid(), e."organizationId", e.id, 'SALA_ESP', 'Sala de Espera', true, 'SALA_ESPERA', now(), now()
FROM public."Establishment" e
WHERE e.active = true
  AND NOT EXISTS (
    SELECT 1 FROM public."ServiceUnit" su
    WHERE su."establishmentId" = e.id AND su.code = 'SALA_ESP'
  );

INSERT INTO public."ServiceUnit" (id, "organizationId", "establishmentId", code, name, active, "areaType", "createdAt", "updatedAt")
SELECT gen_random_uuid(), e."organizationId", e.id, 'MAX_URG', 'Unidad de Máxima Urgencia', true, 'MAX_URGENCIA', now(), now()
FROM public."Establishment" e
WHERE e.active = true
  AND NOT EXISTS (
    SELECT 1 FROM public."ServiceUnit" su
    WHERE su."establishmentId" = e.id AND su.code = 'MAX_URG'
  );



-- -----------------------------------------------------------------------------
-- 4. Verificación
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ServiceUnit' AND column_name = 'areaType'
  ) = 1,
    'ERROR: ServiceUnit.areaType no se creó';
  ASSERT (
    SELECT count(*) FROM public."ServiceUnit" su
    JOIN public."Establishment" e ON e.id = su."establishmentId" AND e.active = true
    WHERE su.code = 'SALA_ESP'
  ) = (SELECT count(*) FROM public."Establishment" WHERE active = true),
    'ERROR: falta SALA_ESP en algún establecimiento activo';
  ASSERT (
    SELECT count(*) FROM public."ServiceUnit" su
    JOIN public."Establishment" e ON e.id = su."establishmentId" AND e.active = true
    WHERE su.code = 'MAX_URG'
  ) = (SELECT count(*) FROM public."Establishment" WHERE active = true),
    'ERROR: falta MAX_URG en algún establecimiento activo';
  RAISE NOTICE 'OK: ServiceUnit.areaType + backfill + seed SALA_ESP/MAX_URG creados';
END $$;
