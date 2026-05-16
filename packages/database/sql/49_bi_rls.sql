-- =============================================================================
-- SQL 49 — BI RLS: Row-Level Security en analytics schema (Beta.19a)
-- Wave: Beta.19a — Fase 6 TDR §26-27
-- Owner: @DA — Data Architect BI
-- Dependencias: SQL 48 (schema analytics + rol bi_reader + matviews)
-- Patron de referencia: public schema RLS (01_rls_policies.sql, 04_rls_session_helpers.sql)
-- =============================================================================
-- El rol bi_reader NO tiene BYPASSRLS. Cada query pasa por las politicas
-- definidas aqui, que filtran por organization_id usando el mismo GUC
-- app.current_org_id que usa el OLTP (via withTenantContext).
--
-- Cubo.dev debe propagar organizationId al contexto Postgres antes de
-- ejecutar queries (via SET LOCAL app.current_org_id = '...').
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECCION 1 — Helpers de contexto RLS (espejean rls_session_helpers del OLTP)
-- -----------------------------------------------------------------------------

-- Funcion auxiliar: leer org_id del contexto (igual que OLTP)
-- Devuelve NULL si el GUC no esta seteado (en lugar de exception)
CREATE OR REPLACE FUNCTION analytics.current_bi_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
  SELECT NULLIF(current_setting('app.current_org_id', TRUE), '')::UUID;
$$;

COMMENT ON FUNCTION analytics.current_bi_org_id IS
  'Devuelve el organization_id del contexto RLS BI.
   Devuelve NULL si app.current_org_id no esta seteado.
   Usada en politicas RLS del schema analytics.';

-- Funcion auxiliar: verificar si el caller es service_role (bypass analitico)
-- service_role tiene BYPASSRLS en Supabase; esta funcion es para documentacion.
CREATE OR REPLACE FUNCTION analytics.is_bi_service_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
  SELECT current_user = 'service_role';
$$;

-- -----------------------------------------------------------------------------
-- SECCION 2 — RLS en dim_organization
-- -----------------------------------------------------------------------------

ALTER TABLE analytics.dim_organization ENABLE ROW LEVEL SECURITY;

-- bi_reader solo ve organizaciones de su contexto
-- service_role ve todo (BYPASSRLS nativo en Supabase)
CREATE POLICY bi_reader_org_isolation ON analytics.dim_organization
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (
    organization_id = analytics.current_bi_org_id()
  );

-- authenticated puede leer su propia org (para queries internas de Cube.dev)
CREATE POLICY authenticated_org_isolation ON analytics.dim_organization
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    organization_id = analytics.current_bi_org_id()
  );

COMMENT ON TABLE analytics.dim_organization IS
  'RLS activo. bi_reader + authenticated filtrados por app.current_org_id.
   service_role: BYPASSRLS (acceso total para refresh + admin).';

-- -----------------------------------------------------------------------------
-- SECCION 3 — RLS en dim_establishment
-- -----------------------------------------------------------------------------

ALTER TABLE analytics.dim_establishment ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_reader_estab_isolation ON analytics.dim_establishment
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (
    organization_id = analytics.current_bi_org_id()
  );

CREATE POLICY authenticated_estab_isolation ON analytics.dim_establishment
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    organization_id = analytics.current_bi_org_id()
  );

-- -----------------------------------------------------------------------------
-- SECCION 4 — RLS en dim_date (no aplica — fecha no tiene org_id)
-- dim_date es compartida entre organizaciones. No se habilita RLS.
-- El filtro de org se aplica en la fact table al hacer JOIN.
-- -----------------------------------------------------------------------------

-- dim_date: sin RLS (todos los roles leen el calendario completo)

-- -----------------------------------------------------------------------------
-- SECCION 5 — Tabla de audit log de queries BI (placeholder Beta.19b)
-- Toda query ejecutada desde Cube.dev/Metabase debera loggear aqui.
-- En Beta.19a: tabla creada vacia. La logica de insercion viene en Beta.19b
-- (via pg_audit extension o hook de Cube.dev).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics.bi_query_log (
  id              BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queried_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  organization_id UUID,
  bi_role         VARCHAR(50),
  query_hash      VARCHAR(64),  -- SHA-256 del query normalizado
  cube_name       VARCHAR(100), -- Cube que genero la query (si aplica)
  duration_ms     INTEGER,
  rows_returned   INTEGER,
  context_json    JSONB,        -- {user_id, dashboard_id, panel_id} de Metabase/Cube
  notes           TEXT
);

COMMENT ON TABLE analytics.bi_query_log IS
  'Audit log de queries analiticas. Retencion: 3 anios (alineado con TDR §6.3).
   Insercion implementada en Beta.19b via pg_audit o Cube.dev query hooks.
   NO usar UPDATE/DELETE: tabla append-only.';

-- bi_query_log: bi_reader puede insertar (log de su propia query), no UPDATE/DELETE
GRANT INSERT ON analytics.bi_query_log TO bi_reader;
GRANT INSERT ON analytics.bi_query_log TO authenticated;
GRANT SELECT ON analytics.bi_query_log TO service_role;

-- RLS en bi_query_log: bi_reader solo ve sus propios logs de su org
ALTER TABLE analytics.bi_query_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_reader_own_logs ON analytics.bi_query_log
  AS PERMISSIVE
  FOR SELECT
  TO bi_reader
  USING (
    organization_id = analytics.current_bi_org_id()
  );

-- INSERT sin restriccion de RLS (log de entrada, antes de filtrar)
CREATE POLICY bi_reader_insert_log ON analytics.bi_query_log
  AS PERMISSIVE
  FOR INSERT
  TO bi_reader
  WITH CHECK (TRUE);

CREATE POLICY authenticated_insert_log ON analytics.bi_query_log
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- Trigger para bloquear UPDATE/DELETE en bi_query_log (append-only)
CREATE OR REPLACE FUNCTION analytics.fn_block_bi_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'bi_query_log es append-only. UPDATE/DELETE no permitidos. (TDR §6.3 audit inmutable)';
END;
$$;

CREATE OR REPLACE TRIGGER trg_bi_query_log_immutable
  BEFORE UPDATE OR DELETE ON analytics.bi_query_log
  FOR EACH ROW
  EXECUTE FUNCTION analytics.fn_block_bi_log_mutation();

-- -----------------------------------------------------------------------------
-- SECCION 6 — Permisos DEFAULT PRIVILEGES para objetos futuros de Beta.19b
-- Cuando @BID cree nuevas matviews en analytics, bi_reader las vera automaticamente
-- si se crean con el rol adecuado. Esta directiva cubre objetos creados por
-- service_role en el schema analytics.
-- -----------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT SELECT ON TABLES TO bi_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT SELECT ON TABLES TO authenticated;

-- -----------------------------------------------------------------------------
-- SECCION 7 — Funciones de contexto RLS para uso en Cube.dev / Edge Functions
-- Cube.dev debe llamar analytics.set_bi_context() al inicio de cada request
-- para propagar el organizationId del securityContext.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics.set_bi_context(
  p_org_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
BEGIN
  -- SET LOCAL solo funciona dentro de transaccion; Cube.dev debe envolver
  -- cada query en un BEGIN/COMMIT o usar una conexion con transaccion activa.
  PERFORM set_config('app.current_org_id', p_org_id::TEXT, TRUE);
END;
$$;

COMMENT ON FUNCTION analytics.set_bi_context IS
  'Establece el contexto de organizacion para RLS en analytics.
   Llamar al inicio de cada request de Cube.dev/Metabase:
     SELECT analytics.set_bi_context(''<org-uuid>'');
   Equivalente analitico de withTenantContext() del OLTP (rls-context.ts).
   IMPORTANTE: SET LOCAL requiere transaccion activa. Cube.dev debe usar
   dataSource.driverFactory con transaccion o el beforeQuery hook.';

-- Solo bi_reader y authenticated pueden llamar set_bi_context
GRANT EXECUTE ON FUNCTION analytics.set_bi_context(UUID) TO bi_reader;
GRANT EXECUTE ON FUNCTION analytics.set_bi_context(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION analytics.set_bi_context(UUID) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- SECCION 8 — Politicas RLS para dims + facts de Beta.19b (placeholders)
-- Cuando @BID cree las matviews en Beta.19b, debe aplicar estas politicas.
-- Se documentan aqui como contratos de gobernanza.
-- -----------------------------------------------------------------------------

-- Ejemplo de patron a replicar para cada fact/dim con organization_id:
--
-- ALTER TABLE analytics.fact_encounter ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY bi_reader_fact_encounter ON analytics.fact_encounter
--   AS PERMISSIVE
--   FOR SELECT
--   TO bi_reader
--   USING (organization_id = analytics.current_bi_org_id());
--
-- CREATE POLICY authenticated_fact_encounter ON analytics.fact_encounter
--   AS PERMISSIVE
--   FOR SELECT
--   TO authenticated
--   USING (organization_id = analytics.current_bi_org_id());
--
-- Politica PHI adicional para dim_patient (requiere rol bi_clinical_lead):
--
-- CREATE POLICY phi_clinical_lead_only ON analytics.dim_patient
--   AS RESTRICTIVE
--   FOR SELECT
--   TO bi_reader
--   USING (
--     EXISTS (
--       SELECT 1 FROM pg_roles
--       WHERE rolname = 'bi_clinical_lead'
--         AND pg_has_role(current_user, rolname, 'MEMBER')
--     )
--   );
--
-- Esta politica RESTRICTIVA + la PERMISSIVE de org_isolation = AND logico.
-- Solo bi_clinical_lead que este en la org correcta puede ver dim_patient.

-- =============================================================================
-- Verificacion post-aplicacion:
--
--   -- Como service_role:
--   SELECT * FROM analytics.dim_organization;                -- ve todo (BYPASSRLS)
--
--   -- Como bi_reader (sin contexto — debe devolver 0 filas):
--   SET ROLE bi_reader;
--   SELECT COUNT(*) FROM analytics.dim_organization;        -- 0 filas (sin org_id seteado)
--
--   -- Como bi_reader con contexto:
--   SELECT analytics.set_bi_context('<uuid-de-org>');
--   SELECT COUNT(*) FROM analytics.dim_organization;        -- filas de la org
--   RESET ROLE;
--
--   -- Intentar UPDATE en bi_query_log (debe fallar):
--   UPDATE analytics.bi_query_log SET notes='test' WHERE id=1;
--   -- ERROR: bi_query_log es append-only...
--
-- =============================================================================
