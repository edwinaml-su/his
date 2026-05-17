-- =====================================================================
-- 55_ece_00_extensions.sql
-- Fase 2 ECE — Expediente Clínico Electrónico (HIS Avante)
-- PRIMER archivo del setup ECE. Habilita extensiones Postgres requeridas
-- y crea el schema lógico `ece` aislado del schema `public`.
-- Aplicar vía Supabase SQL Editor / mcp__supabase__apply_migration.
-- Idempotente: todos los statements usan IF NOT EXISTS.
-- Norma técnica de referencia: Acuerdo n.° 1616 (MINSAL, 2024).
-- =====================================================================

-- Extensiones necesarias para el dominio ECE
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- compatibilidad uuid (clientes legacy)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- similitud de texto (deduplicación de pacientes)

-- Schema lógico ECE — aísla tablas del dominio sin tocar public
CREATE SCHEMA IF NOT EXISTS ece;

COMMENT ON SCHEMA ece IS
  'Expediente Clínico Electrónico — Inversiones Avante / Complejo Hospitalario. '
  'Norma técnica del expediente clínico, Acuerdo n.° 1616 (MINSAL, 2024). '
  'Setup inicial: 55_ece_00_extensions.sql (Fase 2 ECE).';
