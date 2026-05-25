-- =============================================================================
-- Migración 118: Tabla catálogo dosis máxima pediátrica
-- US.JCI.5.12 — Bloqueo de dosis máxima pediátrica en BCMA (IPSG.3 ME 5)
-- JCI Standard: IPSG.3 ME 5
-- =============================================================================

-- ─── 1. Esquema ece (idempotente) ────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS ece;

-- ─── 2. Tabla catálogo (global, sin tenant) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS ece.pediatric_max_dose (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id                   uuid        NOT NULL REFERENCES "Drug"(id) ON DELETE RESTRICT,
  -- Rango de edad en meses (0–216 = 0–18 años)
  edad_min_meses            int         NOT NULL DEFAULT 0,
  edad_max_meses            int         NOT NULL DEFAULT 216,
  -- Límites de dosis (al menos uno debe ser NOT NULL para que el registro tenga sentido)
  max_dose_mg_per_kg        numeric(10,3),          -- mg/kg/dosis
  max_dose_mg_per_kg_per_day numeric(10,3),         -- mg/kg/día acumulado
  max_dose_absolute_mg      numeric(10,3),          -- tope absoluto independiente del peso
  via                       text,                   -- 'oral', 'iv', 'im', 'sc'; NULL = aplica a todas
  fuente                    text        NOT NULL,   -- 'BNF for Children', 'Lexicomp Pediatric', etc.
  activo                    boolean     NOT NULL DEFAULT true,
  creado_en                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drug_id, edad_min_meses, edad_max_meses, via),
  CONSTRAINT pediatric_max_dose_edad_range CHECK (edad_min_meses >= 0 AND edad_max_meses > edad_min_meses),
  CONSTRAINT pediatric_max_dose_limite_check CHECK (
    max_dose_mg_per_kg IS NOT NULL
    OR max_dose_mg_per_kg_per_day IS NOT NULL
    OR max_dose_absolute_mg IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS pediatric_max_dose_drug_idx
  ON ece.pediatric_max_dose (drug_id)
  WHERE activo = true;

-- ─── 3. Seed inicial — 8 medicamentos pediátricos críticos ───────────────────
-- Fuente de referencia: BNF for Children 2023-2024 / Lexicomp Pediatric.
-- Los INSERTs son condicionales: si el drug_id no existe en la BD (env vacío),
-- se ignoran silenciosamente gracias al DO/IF block.
DO $$
DECLARE
  _paracetamol  uuid;
  _ibuprofeno   uuid;
  _amoxicilina  uuid;
  _ceftriaxona  uuid;
  _dexametasona uuid;
  _midazolam    uuid;
  _fentanilo    uuid;
  _gentamicina  uuid;
BEGIN
  SELECT id INTO _paracetamol  FROM "Drug" WHERE lower("genericName") LIKE '%paracetamol%' OR lower("genericName") LIKE '%acetaminophen%' LIMIT 1;
  SELECT id INTO _ibuprofeno   FROM "Drug" WHERE lower("genericName") LIKE '%ibuprofen%'   LIMIT 1;
  SELECT id INTO _amoxicilina  FROM "Drug" WHERE lower("genericName") LIKE '%amoxicillin%' LIMIT 1;
  SELECT id INTO _ceftriaxona  FROM "Drug" WHERE lower("genericName") LIKE '%ceftriaxone%' LIMIT 1;
  SELECT id INTO _dexametasona FROM "Drug" WHERE lower("genericName") LIKE '%dexamethasone%' OR lower("genericName") LIKE '%dexametasona%' LIMIT 1;
  SELECT id INTO _midazolam    FROM "Drug" WHERE lower("genericName") LIKE '%midazolam%'   LIMIT 1;
  SELECT id INTO _fentanilo    FROM "Drug" WHERE lower("genericName") LIKE '%fentanyl%' OR lower("genericName") LIKE '%fentanilo%' LIMIT 1;
  SELECT id INTO _gentamicina  FROM "Drug" WHERE lower("genericName") LIKE '%gentamicin%'  LIMIT 1;

  -- Paracetamol oral (1 mes–18 años): 15 mg/kg/dosis, max 60 mg/kg/día, tope absoluto 1000 mg/dosis
  IF _paracetamol IS NOT NULL THEN
    INSERT INTO ece.pediatric_max_dose
      (drug_id, edad_min_meses, edad_max_meses, max_dose_mg_per_kg, max_dose_mg_per_kg_per_day, max_dose_absolute_mg, via, fuente)
    VALUES
      (_paracetamol, 1, 216, 15.000, 60.000, 1000.000, 'oral', 'BNF for Children 2023-2024')
    ON CONFLICT (drug_id, edad_min_meses, edad_max_meses, via) DO NOTHING;
    -- IV (mismo límite)
    INSERT INTO ece.pediatric_max_dose
      (drug_id, edad_min_meses, edad_max_meses, max_dose_mg_per_kg, max_dose_mg_per_kg_per_day, max_dose_absolute_mg, via, fuente)
    VALUES
      (_paracetamol, 1, 216, 15.000, 60.000, 1000.000, 'iv', 'BNF for Children 2023-2024')
    ON CONFLICT (drug_id, edad_min_meses, edad_max_meses, via) DO NOTHING;
  END IF;

  -- Ibuprofeno oral (3 meses–18 años): 10 mg/kg/dosis, max 40 mg/kg/día, tope 400 mg/dosis
  IF _ibuprofeno IS NOT NULL THEN
    INSERT INTO ece.pediatric_max_dose
      (drug_id, edad_min_meses, edad_max_meses, max_dose_mg_per_kg, max_dose_mg_per_kg_per_day, max_dose_absolute_mg, via, fuente)
    VALUES
      (_ibuprofeno, 3, 216, 10.000, 40.000, 400.000, 'oral', 'BNF for Children 2023-2024')
    ON CONFLICT (drug_id, edad_min_meses, edad_max_meses, via) DO NOTHING;
  END IF;

  -- Amoxicilina oral (1 mes–18 años): 25 mg/kg/dosis, max 90 mg/kg/día, tope 500 mg/dosis
  IF _amoxicilina IS NOT NULL THEN
    INSERT INTO ece.pediatric_max_dose
      (drug_id, edad_min_meses, edad_max_meses, max_dose_mg_per_kg, max_dose_mg_per_kg_per_day, max_dose_absolute_mg, via, fuente)
    VALUES
      (_amoxicilina, 1, 216, 25.000, 90.000, 500.000, 'oral', 'Lexicomp Pediatric 2024')
    ON CONFLICT (drug_id, edad_min_meses, edad_max_meses, via) DO NOTHING;
  END IF;

  -- Ceftriaxona IV/IM (1 mes–18 años): 50 mg/kg/dosis, tope absoluto 2000 mg
  IF _ceftriaxona IS NOT NULL THEN
    INSERT INTO ece.pediatric_max_dose
      (drug_id, edad_min_meses, edad_max_meses, max_dose_mg_per_kg, max_dose_absolute_mg, via, fuente)
    VALUES
      (_ceftriaxona, 1, 216, 50.000, 2000.000, 'iv', 'BNF for Children 2023-2024')
    ON CONFLICT (drug_id, edad_min_meses, edad_max_meses, via) DO NOTHING;

    INSERT INTO ece.pediatric_max_dose
      (drug_id, edad_min_meses, edad_max_meses, max_dose_mg_per_kg, max_dose_absolute_mg, via, fuente)
    VALUES
      (_ceftriaxona, 1, 216, 50.000, 2000.000, 'im', 'BNF for Children 2023-2024')
    ON CONFLICT (drug_id, edad_min_meses, edad_max_meses, via) DO NOTHING;
  END IF;

  -- Dexametasona IV (1 mes–18 años): 0.6 mg/kg/dosis, tope absoluto 10 mg
  IF _dexametasona IS NOT NULL THEN
    INSERT INTO ece.pediatric_max_dose
      (drug_id, edad_min_meses, edad_max_meses, max_dose_mg_per_kg, max_dose_absolute_mg, via, fuente)
    VALUES
      (_dexametasona, 1, 216, 0.600, 10.000, 'iv', 'Lexicomp Pediatric 2024')
    ON CONFLICT (drug_id, edad_min_meses, edad_max_meses, via) DO NOTHING;
  END IF;

  -- Midazolam IV sedación procedimental (6 meses–18 años): 0.1 mg/kg/dosis, tope 5 mg
  IF _midazolam IS NOT NULL THEN
    INSERT INTO ece.pediatric_max_dose
      (drug_id, edad_min_meses, edad_max_meses, max_dose_mg_per_kg, max_dose_absolute_mg, via, fuente)
    VALUES
      (_midazolam, 6, 216, 0.100, 5.000, 'iv', 'BNF for Children 2023-2024')
    ON CONFLICT (drug_id, edad_min_meses, edad_max_meses, via) DO NOTHING;
  END IF;

  -- Fentanilo IV analgesia (2 años–18 años): 1 mcg/kg = 0.001 mg/kg, tope 50 mcg = 0.05 mg
  IF _fentanilo IS NOT NULL THEN
    INSERT INTO ece.pediatric_max_dose
      (drug_id, edad_min_meses, edad_max_meses, max_dose_mg_per_kg, max_dose_absolute_mg, via, fuente)
    VALUES
      (_fentanilo, 24, 216, 0.001, 0.050, 'iv', 'Lexicomp Pediatric 2024')
    ON CONFLICT (drug_id, edad_min_meses, edad_max_meses, via) DO NOTHING;
  END IF;

  -- Gentamicina IV (1 mes–18 años): 2.5 mg/kg/dosis, tope absoluto 120 mg
  IF _gentamicina IS NOT NULL THEN
    INSERT INTO ece.pediatric_max_dose
      (drug_id, edad_min_meses, edad_max_meses, max_dose_mg_per_kg, max_dose_absolute_mg, via, fuente)
    VALUES
      (_gentamicina, 1, 216, 2.500, 120.000, 'iv', 'BNF for Children 2023-2024')
    ON CONFLICT (drug_id, edad_min_meses, edad_max_meses, via) DO NOTHING;
  END IF;

END $$;
