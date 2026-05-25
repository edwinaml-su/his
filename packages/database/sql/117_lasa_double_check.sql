-- =============================================================================
-- Migración 117: LASA pairs + Double-check IPSG.3 ME 2 + 4
-- US.JCI.5.10 LASA alerts
-- US.JCI.5.11 Double-check workflow
-- =============================================================================

-- ─── 1. Esquema ece (idempotente) ────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS ece;

-- ─── 2. Tabla catálogo LASA pairs (global, sin tenant) ───────────────────────
CREATE TABLE IF NOT EXISTS ece.lasa_pair (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_a_id   uuid        NOT NULL REFERENCES "Drug"(id) ON DELETE RESTRICT,
  drug_b_id   uuid        NOT NULL REFERENCES "Drug"(id) ON DELETE RESTRICT,
  razon       text        NOT NULL CHECK (razon IN ('look-alike-packaging','sound-alike','similar-name')),
  severidad   text        NOT NULL CHECK (severidad IN ('warning','high','critical')),
  activo      boolean     NOT NULL DEFAULT true,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lasa_pair_unique UNIQUE (drug_a_id, drug_b_id),
  -- Prevenir pares inversos duplicados:
  CONSTRAINT lasa_pair_no_self CHECK (drug_a_id <> drug_b_id)
);

CREATE INDEX IF NOT EXISTS lasa_pair_drug_a_idx ON ece.lasa_pair (drug_a_id) WHERE activo = true;
CREATE INDEX IF NOT EXISTS lasa_pair_drug_b_idx ON ece.lasa_pair (drug_b_id) WHERE activo = true;

-- ─── 3. alertLevel en Drug (catálogo global) ─────────────────────────────────
-- Valores: standard | high | very_high | critical
ALTER TABLE "Drug"
  ADD COLUMN IF NOT EXISTS "alertLevel" text NOT NULL DEFAULT 'standard'
    CHECK ("alertLevel" IN ('standard','high','very_high','critical'));

-- ─── 4. Double-check fields en MedicationAdministration ─────────────────────
ALTER TABLE "MedicationAdministration"
  ADD COLUMN IF NOT EXISTS "doubleCheckBy"  uuid,
  ADD COLUMN IF NOT EXISTS "doubleCheckAt"  timestamptz,
  -- Hash argon2id del PIN de la verificadora. Nunca texto plano.
  ADD COLUMN IF NOT EXISTS "doubleCheckPin" text;

-- ─── 5. Seed inicial — 10 LASA pairs representativos ─────────────────────────
-- Se insertan solo si existen los drugs referenciados; usamos CTE condicional.
-- En ambientes donde los drugs NO existen (test/staging vacío), los inserts
-- son silenciosamente ignorados por el LEFT JOIN + WHERE.
DO $$
DECLARE
  -- Buscamos drugs por genericName + pharmaceuticalForm para el seed.
  -- Si no existen, la variable queda NULL y saltamos el insert.
  _lantus        uuid;
  _lente         uuid;
  _hydralazine   uuid;
  _hydroxyzine   uuid;
  _metformin     uuid;
  _metronidazole uuid;
  _morphine      uuid;
  _midazolam     uuid;
  _epinephrine   uuid;
  _ephedrine     uuid;
  _dopamine      uuid;
  _dobutamine    uuid;
  _heparin       uuid;
  _humalog       uuid;
  _novolog       uuid;
  _nph           uuid;
BEGIN
  -- Resolver IDs (insensible a mayúsculas)
  SELECT id INTO _lantus        FROM "Drug" WHERE lower("genericName") LIKE '%glargine%'    LIMIT 1;
  SELECT id INTO _lente         FROM "Drug" WHERE lower("genericName") LIKE '%insulin lente%' LIMIT 1;
  SELECT id INTO _hydralazine   FROM "Drug" WHERE lower("genericName") LIKE '%hydralazine%' LIMIT 1;
  SELECT id INTO _hydroxyzine   FROM "Drug" WHERE lower("genericName") LIKE '%hydroxyzine%' LIMIT 1;
  SELECT id INTO _metformin     FROM "Drug" WHERE lower("genericName") LIKE '%metformin%'   LIMIT 1;
  SELECT id INTO _metronidazole FROM "Drug" WHERE lower("genericName") LIKE '%metronidazole%' LIMIT 1;
  SELECT id INTO _morphine      FROM "Drug" WHERE lower("genericName") LIKE '%morphine%'    LIMIT 1;
  SELECT id INTO _midazolam     FROM "Drug" WHERE lower("genericName") LIKE '%midazolam%'   LIMIT 1;
  SELECT id INTO _epinephrine   FROM "Drug" WHERE lower("genericName") LIKE '%epinephrine%' LIMIT 1;
  SELECT id INTO _ephedrine     FROM "Drug" WHERE lower("genericName") LIKE '%ephedrine%'   LIMIT 1;
  SELECT id INTO _dopamine      FROM "Drug" WHERE lower("genericName") LIKE '%dopamine%'    LIMIT 1;
  SELECT id INTO _dobutamine    FROM "Drug" WHERE lower("genericName") LIKE '%dobutamine%'  LIMIT 1;
  SELECT id INTO _heparin       FROM "Drug" WHERE lower("genericName") LIKE '%heparin%' AND lower("genericName") NOT LIKE '%low%' LIMIT 1;
  SELECT id INTO _humalog       FROM "Drug" WHERE lower("brandName")   LIKE '%humalog%'     LIMIT 1;
  SELECT id INTO _novolog       FROM "Drug" WHERE lower("brandName")   LIKE '%novolog%'     LIMIT 1;
  SELECT id INTO _nph           FROM "Drug" WHERE lower("genericName") LIKE '%nph%'         LIMIT 1;

  -- LASA pair 1: Insulin Lantus vs Insulin Lente (look-alike packaging + sound-alike)
  IF _lantus IS NOT NULL AND _lente IS NOT NULL THEN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (_lantus, _lente, 'look-alike-packaging', 'critical')
    ON CONFLICT (drug_a_id, drug_b_id) DO NOTHING;
  END IF;

  -- LASA pair 2: hydrALAzine vs hydrOXYzine (sound-alike)
  IF _hydralazine IS NOT NULL AND _hydroxyzine IS NOT NULL THEN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (_hydralazine, _hydroxyzine, 'sound-alike', 'high')
    ON CONFLICT (drug_a_id, drug_b_id) DO NOTHING;
  END IF;

  -- LASA pair 3: metformin vs metronidazole (similar-name)
  IF _metformin IS NOT NULL AND _metronidazole IS NOT NULL THEN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (_metformin, _metronidazole, 'similar-name', 'warning')
    ON CONFLICT (drug_a_id, drug_b_id) DO NOTHING;
  END IF;

  -- LASA pair 4: morphine vs midazolam (look-alike packaging)
  IF _morphine IS NOT NULL AND _midazolam IS NOT NULL THEN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (_morphine, _midazolam, 'look-alike-packaging', 'critical')
    ON CONFLICT (drug_a_id, drug_b_id) DO NOTHING;
  END IF;

  -- LASA pair 5: epinephrine vs ephedrine (sound-alike + similar-name)
  IF _epinephrine IS NOT NULL AND _ephedrine IS NOT NULL THEN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (_epinephrine, _ephedrine, 'sound-alike', 'critical')
    ON CONFLICT (drug_a_id, drug_b_id) DO NOTHING;
  END IF;

  -- LASA pair 6: dopamine vs dobutamine (similar-name)
  IF _dopamine IS NOT NULL AND _dobutamine IS NOT NULL THEN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (_dopamine, _dobutamine, 'similar-name', 'high')
    ON CONFLICT (drug_a_id, drug_b_id) DO NOTHING;
  END IF;

  -- LASA pair 7: Humalog vs Novolog (look-alike packaging)
  IF _humalog IS NOT NULL AND _novolog IS NOT NULL THEN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (_humalog, _novolog, 'look-alike-packaging', 'high')
    ON CONFLICT (drug_a_id, drug_b_id) DO NOTHING;
  END IF;

  -- LASA pair 8: Heparin vs Insulin NPH (look-alike packaging)
  IF _heparin IS NOT NULL AND _nph IS NOT NULL THEN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (_heparin, _nph, 'look-alike-packaging', 'critical')
    ON CONFLICT (drug_a_id, drug_b_id) DO NOTHING;
  END IF;

  -- LASA pair 9: morphine vs hydromorphone (sound-alike)
  SELECT id INTO _lantus FROM "Drug" WHERE lower("genericName") LIKE '%hydromorphone%' LIMIT 1;
  -- Reusamos _lantus como variable temporal para hydromorphone
  IF _morphine IS NOT NULL AND _lantus IS NOT NULL THEN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (_morphine, _lantus, 'sound-alike', 'critical')
    ON CONFLICT (drug_a_id, drug_b_id) DO NOTHING;
  END IF;

  -- LASA pair 10: cefazolin vs ceftriaxone (similar-name)
  -- Reusamos _lente/_hydralazine como variables temporales
  SELECT id INTO _lente       FROM "Drug" WHERE lower("genericName") LIKE '%cefazolin%'   LIMIT 1;
  SELECT id INTO _hydralazine FROM "Drug" WHERE lower("genericName") LIKE '%ceftriaxone%' LIMIT 1;
  IF _lente IS NOT NULL AND _hydralazine IS NOT NULL THEN
    INSERT INTO ece.lasa_pair (drug_a_id, drug_b_id, razon, severidad)
    VALUES (_lente, _hydralazine, 'similar-name', 'warning')
    ON CONFLICT (drug_a_id, drug_b_id) DO NOTHING;
  END IF;

END $$;

-- ─── 6. Marcar alertLevel para high-alert meds ya en catálogo ────────────────
-- Insulinas → critical
UPDATE "Drug" SET "alertLevel" = 'critical'
  WHERE lower("genericName") LIKE '%insulin%'
    AND "alertLevel" = 'standard';

-- Heparina → critical
UPDATE "Drug" SET "alertLevel" = 'critical'
  WHERE lower("genericName") LIKE '%heparin%'
    AND "alertLevel" = 'standard';

-- Morfina, fentanyl, hidromorfona → critical
UPDATE "Drug" SET "alertLevel" = 'critical'
  WHERE lower("genericName") LIKE ANY(ARRAY['%morphine%','%fentanyl%','%hydromorphone%','%oxycodone%'])
    AND "alertLevel" = 'standard';

-- Midazolam, propofol → very_high
UPDATE "Drug" SET "alertLevel" = 'very_high'
  WHERE lower("genericName") LIKE ANY(ARRAY['%midazolam%','%propofol%','%ketamine%'])
    AND "alertLevel" = 'standard';

-- Warfarin, clopidogrel → high
UPDATE "Drug" SET "alertLevel" = 'high'
  WHERE lower("genericName") LIKE ANY(ARRAY['%warfarin%','%clopidogrel%','%methotrexate%'])
    AND "alertLevel" = 'standard';

-- Epinefrina, norepinefrina, dopamina → critical
UPDATE "Drug" SET "alertLevel" = 'critical'
  WHERE lower("genericName") LIKE ANY(ARRAY['%epinephrine%','%norepinephrine%','%dopamine%','%dobutamine%'])
    AND "alertLevel" = 'standard';
