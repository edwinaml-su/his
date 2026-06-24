-- =============================================================================
-- 176_cc0002_expediente.sql
-- CC-0002 Sprint A — Expediente único por paciente
-- Propósito: Agrega columna "expediente" (formato {PAIS}{AA}{NNNNN}) a Patient,
--   columna "isoAlpha2" a Country, secuencia atómica por (país,AA),
--   función generadora SECURITY DEFINER, triggers de inmutabilidad en
--   public."Patient" y ece.paciente, y backfill determinístico para
--   pacientes existentes con birthDate.
-- Idempotente: usa IF NOT EXISTS / OR REPLACE / ON CONFLICT DO UPDATE.
-- Aplicar vía: Supabase SQL Editor o MCP execute_sql / apply_migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Country: columna isoAlpha2
-- -----------------------------------------------------------------------------
ALTER TABLE public."Country"
  ADD COLUMN IF NOT EXISTS "isoAlpha2" char(2);

-- Índice único parcial (solo filas con valor)
CREATE UNIQUE INDEX IF NOT EXISTS uq_country_iso_alpha2
  ON public."Country" ("isoAlpha2")
  WHERE "isoAlpha2" IS NOT NULL;

-- Seed Centroamérica (solo actualiza si aún no está seteado)
UPDATE public."Country" SET "isoAlpha2" = 'SV' WHERE "isoAlpha3" = 'SLV' AND "isoAlpha2" IS NULL;
UPDATE public."Country" SET "isoAlpha2" = 'GT' WHERE "isoAlpha3" = 'GTM' AND "isoAlpha2" IS NULL;
UPDATE public."Country" SET "isoAlpha2" = 'HN' WHERE "isoAlpha3" = 'HND' AND "isoAlpha2" IS NULL;
UPDATE public."Country" SET "isoAlpha2" = 'CR' WHERE "isoAlpha3" = 'CRI' AND "isoAlpha2" IS NULL;
UPDATE public."Country" SET "isoAlpha2" = 'NI' WHERE "isoAlpha3" = 'NIC' AND "isoAlpha2" IS NULL;
UPDATE public."Country" SET "isoAlpha2" = 'PA' WHERE "isoAlpha3" = 'PAN' AND "isoAlpha2" IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Patient: columna expediente
-- -----------------------------------------------------------------------------
ALTER TABLE public."Patient"
  ADD COLUMN IF NOT EXISTS "expediente" varchar(20);

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_expediente
  ON public."Patient" ("expediente")
  WHERE "expediente" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Tabla de secuencias por (country_code, aa)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.secuencia_expediente (
  country_code char(2)  NOT NULL,
  aa           char(2)  NOT NULL,
  last_value   int      NOT NULL DEFAULT 0,
  PRIMARY KEY (country_code, aa)
);

-- -----------------------------------------------------------------------------
-- 4. Función generadora atómica (upsert → no hay race condition)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_next_expediente(
  p_country_code char(2),
  p_aa           char(2)
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v int;
BEGIN
  -- El INSERT ... ON CONFLICT DO UPDATE es atómico bajo cualquier nivel de
  -- aislamiento ≥ READ COMMITTED: la fila se bloquea con FOR UPDATE implícito
  -- durante el UPDATE, serializando emisiones concurrentes del mismo bucket.
  INSERT INTO public.secuencia_expediente (country_code, aa, last_value)
    VALUES (p_country_code, p_aa, 1)
  ON CONFLICT (country_code, aa)
    DO UPDATE SET last_value = public.secuencia_expediente.last_value + 1
  RETURNING last_value INTO v;
  RETURN v;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Backfill determinístico — solo pacientes con birthDate y país con isoAlpha2
-- -----------------------------------------------------------------------------
-- Se usa row_number() OVER (PARTITION BY pais,aa ORDER BY "createdAt", id)
-- para asignar correlativos 1..N dentro de cada bucket de forma determinística.
-- Los pacientes sin birthDate quedan en NULL (se asignarán al corregir fecha).
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Actualizar expediente para cada paciente elegible (idempotente: solo NULL)
  FOR r IN
    WITH base AS (
      SELECT
        p.id,
        c."isoAlpha2"                          AS pais,
        LPAD(EXTRACT(YEAR FROM p."birthDate")::text, 4, '0') AS yr4,
        RIGHT(EXTRACT(YEAR FROM p."birthDate")::int::text, 2) AS aa
      FROM public."Patient"    p
      JOIN public."Organization" o ON o.id = p."organizationId"
      JOIN public."Country"      c ON c.id = o."countryId"
      WHERE p."birthDate" IS NOT NULL
        AND p."expediente" IS NULL
        AND c."isoAlpha2" IS NOT NULL
    ),
    ranked AS (
      SELECT
        id,
        pais,
        aa,
        ROW_NUMBER() OVER (PARTITION BY pais, aa ORDER BY id) AS rn
      FROM base
    )
    SELECT id, pais, aa, rn FROM ranked
  LOOP
    UPDATE public."Patient"
      SET "expediente" = r.pais || r.aa || LPAD(r.rn::text, 5, '0')
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- Sembrar secuencia_expediente con el máximo rn por bucket (ON CONFLICT → GREATEST)
INSERT INTO public.secuencia_expediente (country_code, aa, last_value)
SELECT
  c."isoAlpha2"                                               AS country_code,
  RIGHT(EXTRACT(YEAR FROM p."birthDate")::int::text, 2)::char(2) AS aa,
  MAX(CAST(RIGHT(p."expediente", 5) AS int))                  AS last_value
FROM public."Patient"   p
JOIN public."Organization" o ON o.id = p."organizationId"
JOIN public."Country"      c ON c.id = o."countryId"
WHERE p."expediente" IS NOT NULL
  AND c."isoAlpha2"  IS NOT NULL
  AND p."birthDate"  IS NOT NULL
GROUP BY c."isoAlpha2", RIGHT(EXTRACT(YEAR FROM p."birthDate")::int::text, 2)
ON CONFLICT (country_code, aa)
  DO UPDATE SET last_value = GREATEST(
    public.secuencia_expediente.last_value,
    EXCLUDED.last_value
  );

-- -----------------------------------------------------------------------------
-- 6. Trigger inmutabilidad en public."Patient"
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_block_expediente_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD."expediente" IS NOT NULL
     AND NEW."expediente" IS DISTINCT FROM OLD."expediente"
  THEN
    RAISE EXCEPTION 'expediente es inmutable (CC-0002 §6): paciente %, valor actual %',
      OLD.id, OLD."expediente";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_expediente ON public."Patient";
CREATE TRIGGER trg_block_expediente
  BEFORE UPDATE ON public."Patient"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_expediente_update();

-- -----------------------------------------------------------------------------
-- 7. Trigger inmutabilidad en ece.paciente.numero_expediente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ece.fn_block_numero_expediente_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ece, public, pg_catalog
AS $$
BEGIN
  IF OLD.numero_expediente IS NOT NULL
     AND NEW.numero_expediente IS DISTINCT FROM OLD.numero_expediente
  THEN
    RAISE EXCEPTION 'numero_expediente es inmutable (CC-0002 §6): paciente ece %, valor actual %',
      OLD.id, OLD.numero_expediente;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_numero_expediente ON ece.paciente;
CREATE TRIGGER trg_block_numero_expediente
  BEFORE UPDATE ON ece.paciente
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_block_numero_expediente_update();
