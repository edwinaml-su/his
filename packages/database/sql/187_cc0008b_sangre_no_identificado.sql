-- =============================================================================
-- 187_cc0008b_sangre_no_identificado.sql
-- CC-0008b — Pre-registro: tipo de sangre "no reportado" + paciente no identificado.
-- Propósito:
--   1) Columna "bloodTypeNotReported" en Patient — distingue explícitamente
--      «el documento no reporta tipo de sangre» (banner rojo específico) de
--      null (aún sin capturar). Complementa bloodTypeAbo/bloodRh (ya existentes
--      en schema.prisma, verificados en exploración previa CC-0008).
--   2) Tabla + función de secuencia diaria por organización para el correlativo
--      del código de identidad temporal del paciente no identificado
--      (DDMMAAAA-NN, distinto del NN-yyyyMMdd-HHmmss de triage.router — no tocar).
-- Patrón: espejo de 176_cc0002_expediente.sql (upsert atómico SECURITY DEFINER).
-- Nota (numeración): el spec original de la tarea pedía "186_..." pero 186a/186b
--   ya fueron tomados por otro stream en paralelo (calculadoras clínicas); se usa
--   187 como siguiente número libre.
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / OR REPLACE.
-- Aplicar vía: Supabase SQL Editor o MCP execute_sql / apply_migration.
-- NO aplicar a prod directamente: aprobado por @Orq en el gate de entrega.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Patient: columna bloodTypeNotReported
-- -----------------------------------------------------------------------------
ALTER TABLE public."Patient"
  ADD COLUMN IF NOT EXISTS "bloodTypeNotReported" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."Patient"."bloodTypeNotReported" IS
  'CC-0008b — el documento de identidad no reporta tipo de sangre (distinto de '
  'bloodTypeAbo/bloodRh = null, que significa "aún sin capturar"). Fuerza banner '
  'de seguridad en rojo con texto "No reportado en documento de identificación".';

-- -----------------------------------------------------------------------------
-- 2. Tabla de secuencia diaria por organización (identidad temporal NN)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.secuencia_no_identificado (
  organization_id uuid NOT NULL,
  fecha           date NOT NULL,
  last_value      int  NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, fecha)
);

COMMENT ON TABLE public.secuencia_no_identificado IS
  'CC-0008b — correlativo diario por organización para el código de identidad '
  'temporal (DDMMAAAA-NN) del "Paciente no identificado". Bucket = (organization_id, fecha).';

-- -----------------------------------------------------------------------------
-- 3. Función generadora atómica (upsert → no hay race condition)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_next_no_identificado(
  p_org   uuid,
  p_fecha date
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v int;
BEGIN
  -- INSERT ... ON CONFLICT DO UPDATE es atómico bajo READ COMMITTED+: la fila
  -- se bloquea con FOR UPDATE implícito durante el UPDATE, serializando
  -- emisiones concurrentes del mismo bucket (organization_id, fecha).
  INSERT INTO public.secuencia_no_identificado (organization_id, fecha, last_value)
    VALUES (p_org, p_fecha, 1)
  ON CONFLICT (organization_id, fecha)
    DO UPDATE SET last_value = public.secuencia_no_identificado.last_value + 1
  RETURNING last_value INTO v;
  RETURN v;
END;
$$;
