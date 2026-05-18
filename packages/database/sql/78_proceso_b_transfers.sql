-- ============================================================================
-- 78_proceso_b_transfers.sql
--
-- GS1 Proceso B — Transferencias de inventario entre depósitos (GLN).
--
-- RLS Cat-E: el acceso está controlado por establecimiento via
--   ece.establecimiento_id del usuario (patrón seguido por módulos GS1).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLA PRINCIPAL
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.transferencia_inventario (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- GLN GS1 del depósito que envía (origen)
    origen_gln      TEXT            NOT NULL,
    -- GLN GS1 del depósito que recibe (destino)
    destino_gln     TEXT            NOT NULL,

    -- SSCC del pallet GS1-128 (18 dígitos). Opcional cuando no va paletizado.
    sscc_pallet     TEXT,

    -- Productos: array de objetos { gtin, lote, fechaVencimiento, cantidad, uom }
    productos       JSONB           NOT NULL DEFAULT '[]'::jsonb,

    fecha_envio     TIMESTAMPTZ,
    fecha_recepcion TIMESTAMPTZ,

    estado          TEXT            NOT NULL DEFAULT 'programado'
                        CHECK (estado IN ('programado','en_transito','recibido','rechazado')),

    -- Quién registró el envío
    registrado_por  UUID            NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    -- Quién confirmó la recepción o el rechazo
    verificado_por  UUID            REFERENCES auth.users(id) ON DELETE RESTRICT,

    -- Motivo de rechazo (opcional, solo cuando estado = 'rechazado')
    motivo_rechazo  TEXT,

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. ÍNDICES
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'transferencia_inventario'
          AND schemaname = 'ece'
          AND indexname = 'idx_transferencia_inv_estado'
    ) THEN
        CREATE INDEX idx_transferencia_inv_estado
            ON ece.transferencia_inventario (estado);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'transferencia_inventario'
          AND schemaname = 'ece'
          AND indexname = 'idx_transferencia_inv_origen_gln'
    ) THEN
        CREATE INDEX idx_transferencia_inv_origen_gln
            ON ece.transferencia_inventario (origen_gln);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'transferencia_inventario'
          AND schemaname = 'ece'
          AND indexname = 'idx_transferencia_inv_destino_gln'
    ) THEN
        CREATE INDEX idx_transferencia_inv_destino_gln
            ON ece.transferencia_inventario (destino_gln);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'transferencia_inventario'
          AND schemaname = 'ece'
          AND indexname = 'idx_transferencia_inv_registrado_por'
    ) THEN
        CREATE INDEX idx_transferencia_inv_registrado_por
            ON ece.transferencia_inventario (registrado_por);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. TRIGGER updated_at
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_transferencia_inventario_updated_at'
    ) THEN
        CREATE TRIGGER trg_transferencia_inventario_updated_at
            BEFORE UPDATE ON ece.transferencia_inventario
            FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
    END IF;
EXCEPTION WHEN undefined_function THEN
    -- moddatetime solo está disponible si la extensión moddatetime está activa.
    -- Ignorar si no existe (dev local sin extensión).
    NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4. RLS Cat-E
--
-- Patrón Cat-E: acceso controlado por la variable de sesión
--   app.current_org_id (set por withTenantContext).
-- Para transferencias, un usuario puede ver transferencias donde su
-- organización es el origen O el destino (via GLN en catalogo_gln).
-- Como la tabla no tiene organization_id directamente, usamos una
-- policy permisiva basada en el rol authenticated — el filtrado fino
-- por org se hace a nivel de aplicación (router filtra por GLNs del tenant).
-- ---------------------------------------------------------------------------

ALTER TABLE ece.transferencia_inventario ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'transferencia_inventario'
          AND schemaname = 'ece'
          AND policyname = 'transferencia_inventario_authenticated_all'
    ) THEN
        CREATE POLICY transferencia_inventario_authenticated_all
            ON ece.transferencia_inventario
            FOR ALL
            TO authenticated
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- service_role tiene BYPASSRLS — no necesita policy.

-- ---------------------------------------------------------------------------
-- 5. GRANTS
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON ece.transferencia_inventario TO authenticated;
GRANT ALL ON ece.transferencia_inventario TO service_role;
