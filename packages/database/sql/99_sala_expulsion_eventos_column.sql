-- =============================================================================
-- HF-10 (audit Stream F PR #183) — agregar columna `eventos` JSONB a
-- ece.sala_expulsion.
--
-- El router `periodo-expulsivo.router.ts` ejecuta:
--   UPDATE ece.sala_expulsion SET eventos = eventos || ${...}::jsonb
-- (línea ~233) y SELECT eventos en `listEventos` y `agregarEvento`. La
-- columna nunca existió en BD — todas las escrituras fallan con
-- ERROR 42703.
--
-- Fix: agregar columna JSONB con default `[]` para que filas existentes
-- (sin eventos previos) tengan estado inicial coherente con el router,
-- que asume un array al hacer `eventos || ...`.
-- =============================================================================

ALTER TABLE ece.sala_expulsion
  ADD COLUMN eventos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ece.sala_expulsion.eventos IS
  'Array JSONB append-only de eventos del periodo expulsivo. Estructura: [{tipo, timestamp, ...}]. Origen append vía router periodo-expulsivo.agregarEvento.';
