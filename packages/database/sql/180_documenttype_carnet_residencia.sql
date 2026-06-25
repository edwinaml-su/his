-- =============================================================================
-- 180_documenttype_carnet_residencia.sql
-- CC-0005 / REQ-ECE-OI-001 — Agrega CARNET_RESIDENCIA al enum nativo DocumentType.
-- Propósito: cerrar el drift Prisma↔BD. El enum Prisma (schema.prisma) y el Zod
--   documentTypeEnum ya declaran CARNET_RESIDENCIA, pero el tipo nativo PG
--   public."DocumentType" creado por 177_cc0002_documento_dedup.sql NO lo tiene.
--   Sin este ALTER, todo INSERT/SELECT con CARNET_RESIDENCIA falla en prod con
--   22P02 (invalid input value for enum).
-- Nota: ALTER TYPE ADD VALUE va en su propio archivo/statement — no puede
--   co-transaccionar con el uso del valor nuevo (gotcha CLAUDE.md; precedentes
--   SQL 136/30a/59/92).
-- Idempotente: ADD VALUE IF NOT EXISTS (Postgres 12+).
-- Aplicar vía: Supabase SQL Editor o MCP execute_sql / apply_migration.
-- NO aplicar a prod directamente: aprobado por @Orq en el gate de entrega.
-- =============================================================================

ALTER TYPE public."DocumentType" ADD VALUE IF NOT EXISTS 'CARNET_RESIDENCIA';
