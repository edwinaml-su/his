-- =====================================================================
-- 169_gs1_jerarquia_empaque.sql
-- Jerarquía de empaque GS1 — Nivel 2 (guía GS1 El Salvador v2.0).
--
-- Modela la jerarquía comercial recursiva GTIN padre→hijo
-- (ej. Caja → Blister → Unidosis) con factor de conversión, fiel al
-- modelo tbl_Catalogo_Comercial del estándar (auto-FK recursiva en la
-- misma tabla ece.gs1_gtin). Enlaza además al catálogo clínico Nivel 1
-- (public."Drug") vía id_clinico_rel.
--
-- RLS: ece.gs1_gtin es Cat-E (SELECT abierto a authenticated, escritura
--   solo service_role). Las columnas nuevas heredan la policy existente.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

ALTER TABLE ece.gs1_gtin
  ADD COLUMN IF NOT EXISTS gtin_contenido     char(14),
  ADD COLUMN IF NOT EXISTS nivel_empaque      text,
  ADD COLUMN IF NOT EXISTS cantidad_contenida numeric(12,3),
  ADD COLUMN IF NOT EXISTS id_clinico_rel     uuid;

-- FK recursiva: GTIN del nivel de empaque inmediatamente inferior.
-- DEFERRABLE para poder poblar jerarquías en cualquier orden dentro de una tx.
ALTER TABLE ece.gs1_gtin DROP CONSTRAINT IF EXISTS fk_gs1_gtin_contenido;
ALTER TABLE ece.gs1_gtin
  ADD CONSTRAINT fk_gs1_gtin_contenido
  FOREIGN KEY (gtin_contenido) REFERENCES ece.gs1_gtin(codigo)
  DEFERRABLE INITIALLY DEFERRED;

-- FK al catálogo clínico Nivel 1 (public."Drug").
ALTER TABLE ece.gs1_gtin DROP CONSTRAINT IF EXISTS fk_gs1_gtin_clinico;
ALTER TABLE ece.gs1_gtin
  ADD CONSTRAINT fk_gs1_gtin_clinico
  FOREIGN KEY (id_clinico_rel) REFERENCES public."Drug"(id)
  ON DELETE SET NULL;

-- Nivel de empaque tipificado (text + CHECK, no enum Postgres).
ALTER TABLE ece.gs1_gtin DROP CONSTRAINT IF EXISTS chk_gs1_gtin_nivel_empaque;
ALTER TABLE ece.gs1_gtin
  ADD CONSTRAINT chk_gs1_gtin_nivel_empaque
  CHECK (nivel_empaque IS NULL OR nivel_empaque IN ('UNIDOSIS','BLISTER','CAJA','PALLET'));

-- Factor de conversión positivo.
ALTER TABLE ece.gs1_gtin DROP CONSTRAINT IF EXISTS chk_gs1_gtin_cantidad;
ALTER TABLE ece.gs1_gtin
  ADD CONSTRAINT chk_gs1_gtin_cantidad
  CHECK (cantidad_contenida IS NULL OR cantidad_contenida > 0);

-- Coherencia jerárquica: UNIDOSIS es nivel hoja (sin hijo);
-- niveles superiores requieren GTIN hijo + cantidad de conversión.
ALTER TABLE ece.gs1_gtin DROP CONSTRAINT IF EXISTS chk_gs1_gtin_jerarquia;
ALTER TABLE ece.gs1_gtin
  ADD CONSTRAINT chk_gs1_gtin_jerarquia
  CHECK (
    nivel_empaque IS NULL
    OR (nivel_empaque =  'UNIDOSIS' AND gtin_contenido IS NULL)
    OR (nivel_empaque <> 'UNIDOSIS' AND gtin_contenido IS NOT NULL AND cantidad_contenida IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_gs1_gtin_contenido
  ON ece.gs1_gtin (gtin_contenido) WHERE gtin_contenido IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gs1_gtin_clinico_rel
  ON ece.gs1_gtin (id_clinico_rel) WHERE id_clinico_rel IS NOT NULL;

COMMENT ON COLUMN ece.gs1_gtin.gtin_contenido IS
  'FK recursiva: GTIN del nivel de empaque inmediatamente inferior. NULL en UNIDOSIS.';
COMMENT ON COLUMN ece.gs1_gtin.nivel_empaque IS
  'Nivel logístico/consumo: UNIDOSIS|BLISTER|CAJA|PALLET (guía GS1 El Salvador Nivel 2).';
COMMENT ON COLUMN ece.gs1_gtin.cantidad_contenida IS
  'Factor de conversión: cantidad de GTIN hijos (gtin_contenido) por unidad de este GTIN.';
COMMENT ON COLUMN ece.gs1_gtin.id_clinico_rel IS
  'FK a public."Drug".id — enlace al catálogo clínico Nivel 1.';

-- ---------------------------------------------------------------------
-- Helper: total de unidosis contenidas en un empaque, descendiendo la
-- jerarquía y multiplicando los factores de conversión hasta la hoja.
-- Ej. Caja(50 blisters) → Blister(10 unidosis) ⇒ 500 unidosis.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ece.fn_gs1_unidosis_por_empaque(p_codigo char(14))
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ece, public, pg_catalog
AS $$
  WITH RECURSIVE jerarquia AS (
    SELECT codigo, gtin_contenido, COALESCE(cantidad_contenida, 1) AS factor_acum
      FROM ece.gs1_gtin
     WHERE codigo = p_codigo
    UNION ALL
    SELECT g.codigo, g.gtin_contenido, j.factor_acum * COALESCE(g.cantidad_contenida, 1)
      FROM ece.gs1_gtin g
      JOIN jerarquia j ON g.codigo = j.gtin_contenido
  )
  SELECT factor_acum
    FROM jerarquia
   WHERE gtin_contenido IS NULL
   LIMIT 1;
$$;

COMMENT ON FUNCTION ece.fn_gs1_unidosis_por_empaque(char) IS
  'Total de unidosis contenidas en un GTIN de empaque, recorriendo la jerarquía '
  'recursiva (gtin_contenido) y multiplicando cantidad_contenida hasta la hoja UNIDOSIS.';
