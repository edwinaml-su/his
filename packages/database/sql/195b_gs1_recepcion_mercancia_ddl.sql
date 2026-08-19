-- =============================================================================
-- 195b_gs1_recepcion_mercancia_ddl.sql
-- DDL base del schema `gs1` — tabla gs1.recepcion_mercancia + función
-- gs1.set_updated_at().
--
-- ORIGEN: este archivo NO fue escrito de cero. El schema `gs1` existe en
-- producción (`ejacvsgbewcerxtjtwto`) con exactamente estos dos objetos
-- (verificado por introspección: `list_tables`/`list_tables(schemas:['gs1'])`
-- devuelve solo esta tabla; `pg_proc` filtrado por `pronamespace='gs1'`
-- devuelve solo esta función) pero ningún archivo de este corpus crea el
-- schema `gs1` ni ninguno de los dos objetos. `196_owasp2025_a02_secdef_hardening.sql`
-- (línea 77, `ALTER FUNCTION gs1.set_updated_at() SET search_path = ...`)
-- asume que la función ya existe y falla en una reconstrucción desde cero
-- por esta razón — ver docs/runbooks/db-reconstruccion-fuera-de-supabase.md.
-- (`96_function_search_path_hardening.sql` también referencia esta función
-- pero envuelta en `DO $$ ... EXCEPTION WHEN OTHERS THEN NULL; END $$`, así
-- que NO falla por su ausencia — no es una raíz de fallo, solo `196` lo es.)
--
-- Este DDL fue RECUPERADO POR INTROSPECCIÓN de la BD de producción (lectura
-- vía information_schema/pg_catalog: columns, pg_constraint, pg_indexes,
-- pg_policy, pg_trigger, pg_get_functiondef) el 2026-08-19, NO escrito desde
-- el diseño original — es una reconstrucción de lo que ya existe, no la
-- fuente original. Numerado 195b (antes de 196, sort -V) para que el runner
-- (`packages/database/scripts/reconstruct-schema.mjs`) lo aplique antes del
-- consumidor real.
--
-- NOTA (hallazgo colateral, fuera de alcance de esta tarea): existe también
-- `ece.recepcion_mercancia`, con columnas distintas (establecimiento_id en
-- vez de organization_id, sin verificacion_5correctos/verificado_por/
-- verificado_en, motivo_rechazo en vez de razon_rechazo). NO es un duplicado
-- exacto — son dos tablas con distinto grano de tenancy y distinto detalle
-- de verificación. Reportado aparte como posible deuda a consolidar.
--
-- No se listan GRANT explícitos a anon/authenticated/service_role: en prod
-- esta tabla solo tiene privilegios para el rol `postgres` (owner) — ningún
-- rol de aplicación tiene grants directos hoy (confirmado via
-- information_schema.role_table_grants). Las policies de abajo son
-- reconstrucción fiel de ese estado — no se añaden grants que prod no tiene.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS gs1;

-- ---------------------------------------------------------------------------
-- gs1.set_updated_at() — trigger function genérica, mantiene actualizado_en.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gs1.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'gs1', 'public', 'pg_catalog'
AS $function$
BEGIN
    NEW.actualizado_en = now();
    RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- gs1.recepcion_mercancia — recepción de mercancía GS1 (verificación de los
-- "5 correctos" al recibir un pallet/lote en almacén), tenant-scoped por
-- organization_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gs1.recepcion_mercancia (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_documento_recepcion  text        NOT NULL,
  fecha                       timestamptz NOT NULL DEFAULT now(),
  proveedor_gln               text        NOT NULL,
  sscc_pallet                 text,
  productos                   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  verificacion_5correctos     jsonb       NOT NULL DEFAULT '{"via_na": true, "hora_na": true, "dosis_na": true, "medicamento": false, "paciente_na": true}'::jsonb,
  registrado_por              uuid        NOT NULL,
  organization_id             uuid        NOT NULL,
  estado                      text        NOT NULL DEFAULT 'pendiente',
  razon_rechazo               text,
  rechazado_por               uuid,
  rechazado_en                timestamptz,
  verificado_por              uuid,
  verificado_en               timestamptz,
  creado_en                   timestamptz NOT NULL DEFAULT now(),
  actualizado_en              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recepcion_mercancia_estado_check
    CHECK (estado = ANY (ARRAY['pendiente'::text, 'verificado'::text, 'rechazado'::text])),
  CONSTRAINT chk_rechazo_razon
    CHECK (estado <> 'rechazado'::text OR razon_rechazo IS NOT NULL),
  CONSTRAINT uq_recepcion_doc_org
    UNIQUE (numero_documento_recepcion, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_recepcion_org_fecha
  ON gs1.recepcion_mercancia (organization_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_recepcion_estado
  ON gs1.recepcion_mercancia (organization_id, estado);

CREATE INDEX IF NOT EXISTS idx_recepcion_sscc
  ON gs1.recepcion_mercancia (sscc_pallet) WHERE (sscc_pallet IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_recepcion_gln
  ON gs1.recepcion_mercancia (proveedor_gln);

DROP TRIGGER IF EXISTS trg_recepcion_updated_at ON gs1.recepcion_mercancia;
CREATE TRIGGER trg_recepcion_updated_at
  BEFORE UPDATE ON gs1.recepcion_mercancia
  FOR EACH ROW EXECUTE FUNCTION gs1.set_updated_at();

ALTER TABLE gs1.recepcion_mercancia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recepcion_org_select ON gs1.recepcion_mercancia;
CREATE POLICY recepcion_org_select ON gs1.recepcion_mercancia
  FOR SELECT TO authenticated
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);

DROP POLICY IF EXISTS recepcion_org_insert ON gs1.recepcion_mercancia;
CREATE POLICY recepcion_org_insert ON gs1.recepcion_mercancia
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (current_setting('app.current_org_id', true))::uuid);

DROP POLICY IF EXISTS recepcion_org_update ON gs1.recepcion_mercancia;
CREATE POLICY recepcion_org_update ON gs1.recepcion_mercancia
  FOR UPDATE TO authenticated
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.current_org_id', true))::uuid);
