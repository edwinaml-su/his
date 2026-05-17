-- ============================================================================
-- 80_proceso_f_devoluciones.sql
--
-- Proceso F — Logística inversa GS1: devoluciones de inventario.
--
-- La tabla `ece.devolucion_inventario` registra el ciclo de vida completo de
-- una devolución de productos (medicamentos, insumos) desde un nodo logístico
-- de origen hacia un destino (proveedor, bodega central, etc.), identificados
-- por GLN GS1.
--
-- RLS Cat-E: acceso filtrado por establecimiento activo en el contexto ECE
-- (app.ece_establecimiento_id). El campo `establecimiento_id` se infiere del
-- personal que autoriza.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tabla principal
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.devolucion_inventario (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificadores GS1 de origen y destino
  origen_gln          TEXT        NOT NULL CHECK (length(trim(origen_gln)) >= 4),
  destino_gln         TEXT        NOT NULL CHECK (length(trim(destino_gln)) >= 4),
  -- Motivo de la devolución (dominio cerrado)
  motivo              TEXT        NOT NULL CHECK (
    motivo IN ('vencido', 'defectuoso', 'recall', 'exceso', 'no_administrado')
  ),
  -- Lista de productos: [{gtin, lote, cantidad}]
  -- gtin: string (GTIN-14), lote: string, cantidad: number > 0
  productos           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Fecha en que se realizó / se solicita la devolución
  fecha_devolucion    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Personal de salud que autoriza (FK a ece.personal_salud)
  autorizado_por      UUID        REFERENCES ece.personal_salud(id) ON DELETE RESTRICT,
  -- Establecimiento del autorizador (para RLS Cat-E)
  establecimiento_id  UUID        REFERENCES ece.establecimiento(id) ON DELETE RESTRICT,
  -- Estado del ciclo de vida
  estado              TEXT        NOT NULL DEFAULT 'solicitado' CHECK (
    estado IN ('solicitado', 'autorizado', 'en_transito', 'recibido', 'rechazado')
  ),
  -- Notas libres (observaciones, número de guía, etc.)
  notas               TEXT,
  -- Auditoría
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID        NOT NULL  -- FK auth.users (no FK explícita para evitar cross-schema)
);

COMMENT ON TABLE ece.devolucion_inventario IS
  'Proceso F GS1 — Logística inversa. Ciclo de vida de devoluciones de productos '
  '(solicitado → autorizado → en_transito → recibido / rechazado). '
  'RLS Cat-E filtrado por establecimiento_id del autorizador.';

COMMENT ON COLUMN ece.devolucion_inventario.productos IS
  'Array JSONB [{gtin: string, lote: string, cantidad: number}]. '
  'gtin: GTIN-14 GS1 Healthcare. cantidad debe ser > 0.';

-- ---------------------------------------------------------------------------
-- Trigger: updated_at automático
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.devolucion_inventario_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at ON ece.devolucion_inventario;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON ece.devolucion_inventario
  FOR EACH ROW EXECUTE FUNCTION ece.devolucion_inventario_set_updated_at();

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_devolucion_estado
  ON ece.devolucion_inventario(estado);

CREATE INDEX IF NOT EXISTS idx_devolucion_establecimiento
  ON ece.devolucion_inventario(establecimiento_id);

CREATE INDEX IF NOT EXISTS idx_devolucion_fecha
  ON ece.devolucion_inventario(fecha_devolucion DESC);

CREATE INDEX IF NOT EXISTS idx_devolucion_autorizado_por
  ON ece.devolucion_inventario(autorizado_por);

-- ---------------------------------------------------------------------------
-- RLS Cat-E
-- ---------------------------------------------------------------------------

ALTER TABLE ece.devolucion_inventario ENABLE ROW LEVEL SECURITY;

-- SELECT / INSERT / UPDATE: solo si el establecimiento_id coincide con el contexto ECE.
-- El `service_role` (BYPASSRLS) es quien escribe autorizado_por y establece el id.
DROP POLICY IF EXISTS devolucion_by_establecimiento ON ece.devolucion_inventario;
CREATE POLICY devolucion_by_establecimiento ON ece.devolucion_inventario
  FOR ALL TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id_safe());
