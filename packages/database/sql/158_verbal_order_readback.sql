-- =============================================================================
-- 158_verbal_order_readback.sql
-- JCI IPSG.2-H1 — Read-back auditable de órdenes verbales.
--
-- Hallazgo: ece.verbal_order tenía confirmado_en pero sin campos de read-back
-- explícitos que el surveyor JCI pueda auditar como evidencia del ciclo
-- "repetir la orden en voz alta antes de confirmar" (IPSG.2 ME 1).
--
-- Agrega:
--   readback_at     — timestamp de cuando se ejecutó el read-back
--   readback_by     — UUID del usuario HIS que ejecutó el read-back (FK → public."User")
--   readback_text   — texto exacto que el receptor repitió de vuelta
--   readback_match  — true si el MC confirmó que coincidía; false si había discrepancia
--
-- La lógica de enforcement (readbackMatch=false bloquea confirmación) vive en
-- el router TS (verbal-order.router.ts / confirmReadback).
--
-- Idempotente. Sin tocar políticas RLS existentes.
-- Aplicado a Supabase prod vía mcp__supabase__apply_migration
-- nombre: verbal_order_readback_ipsg2_h1
-- =============================================================================

ALTER TABLE ece.verbal_order
  ADD COLUMN IF NOT EXISTS readback_at    timestamptz,
  ADD COLUMN IF NOT EXISTS readback_by    uuid,
  ADD COLUMN IF NOT EXISTS readback_text  text,
  ADD COLUMN IF NOT EXISTS readback_match boolean;

-- FK: readback_by → public."User"(id) — persona HIS que ejecutó el read-back
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'ece'
      AND table_name = 'verbal_order'
      AND constraint_name = 'vo_readback_by_fkey'
  ) THEN
    ALTER TABLE ece.verbal_order
      ADD CONSTRAINT vo_readback_by_fkey
        FOREIGN KEY (readback_by) REFERENCES public."User"(id)
        ON DELETE RESTRICT;
  END IF;
END $$;

-- Índice parcial: solo filas donde el read-back ya fue registrado
CREATE INDEX IF NOT EXISTS vo_readback_at_idx
  ON ece.verbal_order(readback_at)
  WHERE readback_at IS NOT NULL;

-- Comentarios de documentación
COMMENT ON COLUMN ece.verbal_order.readback_at IS
  'JCI IPSG.2-H1: timestamp del momento en que el receptor ejecutó el read-back verbal.';

COMMENT ON COLUMN ece.verbal_order.readback_by IS
  'JCI IPSG.2-H1: UUID del usuario HIS (tabla public."User") que ejecutó el read-back.';

COMMENT ON COLUMN ece.verbal_order.readback_text IS
  'JCI IPSG.2-H1: texto exacto que el receptor repitió de vuelta al emisor de la orden.';

COMMENT ON COLUMN ece.verbal_order.readback_match IS
  'JCI IPSG.2-H1: true si el MC confirmó que el read-back coincidió; false si hubo discrepancia. NULL = read-back aún no realizado.';
