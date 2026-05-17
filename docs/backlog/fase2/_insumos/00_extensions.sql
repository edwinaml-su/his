-- =====================================================================
-- 00_extensions.sql
-- Expediente Clínico Electrónico (ECE) - El Salvador / SNIS
-- Extensiones requeridas. Ejecutar primero.
-- =====================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "uuid-ossp";      -- compatibilidad uuid
create extension if not exists "pg_trgm";        -- búsqueda por similitud (deduplicación de pacientes)

-- Esquema lógico del ECE (mantiene aisladas las tablas de dominio)
create schema if not exists ece;

comment on schema ece is
  'Expediente Clínico Electrónico. Norma técnica del expediente clínico, Acuerdo n.° 1616 (MINSAL, 2024).';
