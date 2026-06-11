-- =============================================================================
-- Migration 168: gs1_gln — columnas de jerarquía y lookup por UUID
--
-- Contexto:
--   La tabla ece.gs1_gln tiene PK en codigo (text, GLN-13).
--   Diez (10) FKs externas apuntan a ece.gs1_gln(codigo):
--     BiomedicalEquipment.glnUbicacionActual, BiomedicalEquipment.gln_ubicacion_actual,
--     ece.epcis_event_equipment.gln_origen/destino,
--     ece.epcis_event.gln_origen/destino,
--     ece.gs1_sscc.origen_gln/destino_gln,
--     ece.inventory_threshold.ubicacion_gln,
--     ece.recepcion_mercancia.proveedor_gln
--   → NO es seguro cambiar el PK. codigo permanece como PK.
--
-- Solución:
--   1. Agregar columna `id` uuid NOT NULL DEFAULT gen_random_uuid()
--      con UNIQUE constraint → permite lookup e integridad referencial por UUID.
--   2. Agregar columna `parent_id` uuid REFERENCES ece.gs1_gln(id)
--      → jerarquía padre-hijo por UUID (no por codigo, evita dependencia de
--      la PK text y simplifica CTE recursivas que ya usan $queryRawUnsafe).
--   3. Agregar columna `establecimiento_id` uuid
--      → router glnRouter ya asume esta columna en SELECT/INSERT.
--
-- Idempotente: todos los ADD COLUMN usan IF NOT EXISTS.
-- =============================================================================

-- 1. Columna id — UUID surrogate con unicidad garantizada
ALTER TABLE ece.gs1_gln
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

-- Índice unique para que parent_id pueda hacer FK a id
CREATE UNIQUE INDEX IF NOT EXISTS gs1_gln_id_unique ON ece.gs1_gln (id);

-- 2. Columna parent_id — jerarquía padre-hijo
--    FK referencia id (no codigo) para evitar dependencia del PK text
ALTER TABLE ece.gs1_gln
  ADD COLUMN IF NOT EXISTS parent_id uuid
    REFERENCES ece.gs1_gln(id) ON DELETE SET NULL;

-- 3. Columna establecimiento_id — asociación con establecimiento
ALTER TABLE ece.gs1_gln
  ADD COLUMN IF NOT EXISTS establecimiento_id uuid;

-- Índice para búsquedas por establecimiento
CREATE INDEX IF NOT EXISTS gs1_gln_establecimiento_idx
  ON ece.gs1_gln (establecimiento_id)
  WHERE establecimiento_id IS NOT NULL;
