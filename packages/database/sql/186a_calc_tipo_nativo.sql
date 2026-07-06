-- =============================================================================
-- CC-0009 — AHA PREVENT™ · Parte A: nuevo valor de enum `nativo` en CalcTipo
-- Schema: ece
-- Aplicar vía Supabase SQL Editor / MCP (mcp__supabase__apply_migration)
--
-- ⚠ DEBE aplicarse en su PROPIA transacción, ANTES de 186b. Postgres no permite
--   usar un valor de enum recién agregado dentro de la misma transacción que lo
--   agrega (precedente 30a/30b en este repo). Por eso se separa del seed.
-- =============================================================================

ALTER TYPE ece."CalcTipo" ADD VALUE IF NOT EXISTS 'nativo';
