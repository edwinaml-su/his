-- =============================================================================
-- 259_r1_bi_reader.sql — R1.5 (plan de remediación 2026-09): rol bi_reader
-- a prod, ACTUALIZADO al estado real (NO aplicado — requiere OK de Edwin).
--
-- Relación con sql/48 y sql/49 (histórico NO aplicado — ver anotación
-- agregada a SUS cabeceras en este mismo commit):
--   sql/48_bi_analytics_schema.sql pretendía crear el schema `analytics`
--   COMPLETO (dim_date, dim_organization, dim_establishment, dataset_catalog,
--   rol bi_reader, timeouts) y sql/49_bi_rls.sql las policies RLS +
--   current_bi_org_id()/set_bi_context() sobre ese schema. NINGUNO de los
--   dos se aplicó jamás a prod — confirmado por sql/249 ("capa BI 48/49
--   sigue sin aplicar — bi_reader no existe").
--
--   Pero el schema `analytics` SÍ existe en prod, poblado ad-hoc por otros
--   dos SQL que NO dependen de 48/49 y que SÍ están aplicados:
--     - sql/122_kpi_falls_rate.sql      → analytics.kpi_falls_rate_monthly
--     - sql/249_cc0036_tableros.sql     → analytics.mv_rentabilidad_afiliado
--                                          + analytics.current_bi_org_id()
--                                          (recreada ahí 1:1 porque sql/49
--                                          nunca la sembró)
--   Ambas matviews son SECURITY DEFINER-wrapped (fn_rentabilidad_afiliado,
--   patrón kpi_falls) — el acceso de aplicación pasa por la función, nunca
--   por GRANT SELECT directo. Este archivo NO cambia ese contrato.
--
-- Qué hace ESTE archivo (y qué NO):
--   1. Crea el rol `bi_reader` (NOLOGIN) + timeouts, igual que sql/48 §1.
--   2. GRANT USAGE en el schema `analytics` (que sí existe) a bi_reader.
--   3. GRANT SELECT/INSERT condicionales SOLO sobre los objetos de sql/48
--      que existan hoy — ninguno existe en prod (dim_date, dim_organization,
--      dim_establishment, dataset_catalog, bi_query_log son parte de 48,
--      nunca aplicado), así que estos GRANT son no-op hoy y quedan listos
--      para cuando 48 se aplique de verdad. Usa `to_regclass` — lección
--      "77/227 SQL fallan en Postgres limpio" (docs/runbooks/
--      db-reconstruccion-fuera-de-supabase.md): nunca asumas que un objeto
--      existe solo porque su script "debería" haber corrido.
--   4. Completa el REVOKE que sql/249 documentó pero no pudo escribir
--      (bi_reader no existía todavía → `REVOKE ... FROM bi_reader` habría
--      abortado la transacción con "role does not exist"): niega
--      explícitamente el acceso directo de bi_reader a
--      `analytics.mv_rentabilidad_afiliado` (cifras financieras por
--      organización). Extiende la misma defensa, por la misma razón
--      (matview sin RLS nativo posible), a `analytics.kpi_falls_rate_monthly`
--      — no estaba en el REVOKE de sql/249 (es de sql/122, anterior),
--      pero es la misma categoría de riesgo y el REVOKE es no-op seguro si
--      bi_reader nunca tuvo acceso.
--   5. Deliberadamente NO incluye `ALTER DEFAULT PRIVILEGES IN SCHEMA
--      analytics GRANT SELECT ON TABLES TO bi_reader` (sql/49 §6): esa
--      regla es prospectiva (aplica a tablas FUTURAS creadas por el rol que
--      la ejecuta), no "objetos que existan hoy". Aplicarla a ciegas sería
--      un riesgo silencioso: sql/50 (histórico, tampoco aplicado) modela
--      `dim_patient` con PHI redactada pero pensada para una policy
--      RESTRICTIVE adicional (`bi_clinical_lead`, ver sql/49 §8) — un
--      DEFAULT PRIVILEGES ciego expondría esa futura matview a bi_reader
--      sin esa policy si alguien aplica 50 sin releer 49 completo. Decisión
--      @Dev, no @DA — @DA/@BID deben revisar y decidir explícito cuando se
--      retome la ola BI real.
--   6. NO aplica las RLS policies de sql/49 (bi_reader_org_isolation, etc.)
--      — eso exige backportear 48+49 completos con datos reales para
--      probar, fuera del alcance de "crear el rol". Con bi_reader sin
--      policies y sin GRANT SELECT directo en ningún objeto real, el rol
--      queda creado pero sin acceso de lectura efectivo — seguro por
--      default, listo para que @DA lo complete cuando se retome Beta.19.
--
-- Idempotente: CREATE ROLE guardado en DO block, GRANT/REVOKE son
-- idempotentes por naturaleza en Postgres, GRANT condicional via
-- to_regclass. Puede re-ejecutarse sin efectos secundarios.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Rol bi_reader (idéntico a sql/48 §1)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_reader') THEN
    CREATE ROLE bi_reader NOLOGIN NOSUPERUSER NOREPLICATION;
  END IF;
END;
$$;

ALTER ROLE bi_reader SET statement_timeout = '30s';
ALTER ROLE bi_reader SET lock_timeout = '5s';
ALTER ROLE bi_reader SET work_mem = '64MB';

-- -----------------------------------------------------------------------------
-- 2. Schema analytics — ya existe en prod (creado ad-hoc por sql/122/249,
--    no por sql/48). `IF NOT EXISTS` es no-op seguro si ya existe.
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS analytics;

REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
REVOKE ALL ON SCHEMA analytics FROM anon;
GRANT USAGE ON SCHEMA analytics TO bi_reader;

-- -----------------------------------------------------------------------------
-- 3. Grants condicionales — SOLO sobre objetos de sql/48 que existan hoy.
--    Ninguno de estos 5 existe en prod al momento de escribir esto (48 nunca
--    se aplicó), así que las 5 ramas son no-op — quedan listas para cuando
--    @DA aplique 48 de verdad, sin tener que recordar volver a tocar grants.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('analytics.dim_date') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON analytics.dim_date TO bi_reader';
  END IF;

  IF to_regclass('analytics.dim_organization') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON analytics.dim_organization TO bi_reader';
  END IF;

  IF to_regclass('analytics.dim_establishment') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON analytics.dim_establishment TO bi_reader';
  END IF;

  IF to_regclass('analytics.dataset_catalog') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON analytics.dataset_catalog TO bi_reader';
  END IF;

  -- sql/49: bi_reader solo INSERTA su propio log (append-only), nunca SELECT/UPDATE/DELETE.
  IF to_regclass('analytics.bi_query_log') IS NOT NULL THEN
    EXECUTE 'GRANT INSERT ON analytics.bi_query_log TO bi_reader';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Completa el REVOKE que sql/249 documentó y omitió (bi_reader no existía
--    todavía). Defensa en profundidad: estas matviews no tienen RLS nativo
--    (limitación de Postgres en MATERIALIZED VIEW) y exponen datos
--    financieros/clínicos agregados — el acceso de aplicación pasa por
--    funciones SECURITY DEFINER filtradas por current_bi_org_id(), nunca por
--    SELECT directo de bi_reader sobre la matview.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('analytics.mv_rentabilidad_afiliado') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON analytics.mv_rentabilidad_afiliado FROM bi_reader';
  END IF;

  IF to_regclass('analytics.kpi_falls_rate_monthly') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON analytics.kpi_falls_rate_monthly FROM bi_reader';
  END IF;
END;
$$;

COMMIT;

-- =============================================================================
-- Verificación post-aplicación:
--
--   SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'bi_reader';
--   -- rolcanlogin debe ser false (NOLOGIN)
--
--   SELECT grantee, table_schema, table_name, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE grantee = 'bi_reader';
--   -- Hoy: 0 filas (ningún objeto real de sql/48 existe) o, si bi_query_log
--   -- ya existe, solo INSERT ahí. NUNCA debe listar mv_rentabilidad_afiliado
--   -- ni kpi_falls_rate_monthly.
--
--   SELECT has_table_privilege('bi_reader', 'analytics.mv_rentabilidad_afiliado', 'SELECT');
--   -- debe ser false
-- =============================================================================
