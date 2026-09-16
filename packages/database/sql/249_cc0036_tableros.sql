-- =============================================================================
-- 249_cc0036_tableros.sql
-- CC-0036 Ola 6 (REQ-HIS-AFIL-001 S7, US.AFIL.1.8) — Tableros de rentabilidad
-- por afiliado y ocupación de consultorios. ÚLTIMA ola del REQ-HIS-AFIL-001.
--
-- NFR-2: "Tableros: p95 < 1.5 s con 24 meses de historia; se permite vista
-- materializada en analytics refrescada por cron."
--
-- DECISIÓN @Dev (documentada aquí, no solo en el PR): solo el tablero de
-- RENTABILIDAD (AC1/AC2/AC4/AC5) usa matview — es la agregación cara (JOIN de
-- ContratoCargo + ProduccionMedica x mes x afiliado, 24 meses de historia).
-- La OCUPACIÓN (AC3) se resuelve en el router reusando
-- `public.fn_agenda_disponibilidad()`, el mismo patrón que
-- `outpatient.router.ts` (`tablero.indicadores`, CC-0036 Ola 4) ya documenta
-- como "sin matview aún — NFR-2 lo permite": el volumen de agendas por
-- consultorio en un período acotado (un mes, no 24) no justifica un segundo
-- objeto materializado en esta ola.
--
-- Seguridad — por qué esto NO es un simple GRANT SELECT como sql/122:
-- Los MATERIALIZED VIEW de Postgres no admiten `ENABLE ROW LEVEL SECURITY`
-- (limitación del motor). `analytics.kpi_falls_rate_monthly` (sql/122) vive
-- así, sin RLS ni wrapper, porque agrega datos clínicos ya des-identificados
-- a nivel establecimiento. Esta matview en cambio expone CIFRAS FINANCIERAS
-- por organización (renta, honorarios, margen) — no basta con confiar en que
-- el router siempre agregue el WHERE. En su lugar, copiamos el patrón MÁS
-- estricto ya sembrado en sql/49 (`analytics.current_bi_org_id()`, lee el GUC
-- `app.current_org_id` que `withTenantContext` ya fija — rls-context.ts) y lo
-- envolvemos en una función SECURITY DEFINER: es la ÚNICA vía de lectura de
-- la matview para roles de aplicación. Defensa en profundidad, no defensa
-- única (ver CLAUDE.md §RLS: "el filtro where es defensa débil").
--
-- bi_reader (Cube.dev, sql/48/49) NO recibe acceso en esta ola —
-- ALTER DEFAULT PRIVILEGES de sql/49 lo habría hecho automático vía GRANT
-- SELECT, así que se revoca explícito. GAP documentado: si un futuro tablero
-- BI necesita esta matview, requiere su propio wrapper con
-- `analytics.current_bi_org_id()` o una policy — no un GRANT directo.
--
-- PENDIENTE DE APLICAR — @Orq aplica a prod vía MCP Supabase. Una vez
-- aplicado, marcar este encabezado "APLICADO" y NO re-aplicar (DROP...CREATE
-- es idempotente en estructura pero pisa el contenido hasta el próximo
-- refresh de cron).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Matview analytics.mv_rentabilidad_afiliado
--    Grano: organization_id x medico_afiliado_id x establishment_id x mes.
-- -----------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_rentabilidad_afiliado CASCADE;

CREATE MATERIALIZED VIEW analytics.mv_rentabilidad_afiliado AS
WITH renta AS (
  -- ContratoCargo RENTA+SERVICIOS devengados, por afiliado x establecimiento
  -- (vía Consultorio del contrato) x mes.
  SELECT
    ca."organizationId"                                          AS organization_id,
    ca."medicoAfiliadoId"                                         AS medico_afiliado_id,
    co."establishmentId"                                          AS establishment_id,
    date_trunc('month', cc.periodo)::date                         AS period_month,
    SUM(cc.monto) FILTER (
      WHERE cc.concepto IN ('RENTA', 'SERVICIOS') AND cc.estado <> 'ANULADO'
    )                                                              AS renta_devengada,
    -- PAGADO es estado RESERVADO sin escritor en esta fase (ContratoCargo
    -- solo produce DEVENGADO/ANULADO — ver comentario del modelo en
    -- schema.prisma). Esta columna es siempre 0 hoy; se documenta explícito
    -- para no confundir "0" calculado con "sin cobro real".
    SUM(cc.monto) FILTER (WHERE cc.estado = 'PAGADO')              AS renta_cobrada
  FROM public."ContratoCargo" cc
  JOIN public."ContratoArrendamiento" ca ON ca.id = cc."contratoId"
  JOIN public."Consultorio" co ON co.id = ca."consultorioId"
  GROUP BY 1, 2, 3, 4
),

produccion_por_linea AS (
  -- Producción facturada agrupada por línea de negocio = origen del cargo
  -- ORIGEN (PatientAccountService.origen — packages/contracts/src/schemas/
  -- charge-origin.ts). REVERSADO excluido: el cargo que lo originó fue
  -- reversado, no hubo producción real. EXCLUIDO SÍ cuenta (el acto clínico
  -- se facturó igual; solo no generó honorario).
  SELECT
    pm."organizationId"                                           AS organization_id,
    pm."medicoAfiliadoId"                                         AS medico_afiliado_id,
    pm."establishmentId"                                          AS establishment_id,
    date_trunc('month', pm.fecha)::date                           AS period_month,
    COALESCE(pas.origen, 'OTRO')                                  AS linea,
    SUM(pm."montoFacturado")                                      AS monto
  FROM public."ProduccionMedica" pm
  JOIN public."PatientAccountService" pas ON pas.id = pm."patientAccountServiceId"
  WHERE pm.estado <> 'REVERSADO'
  GROUP BY 1, 2, 3, 4, 5
),

produccion AS (
  SELECT
    organization_id, medico_afiliado_id, establishment_id, period_month,
    SUM(monto)                                                    AS produccion_total,
    jsonb_object_agg(linea, monto ORDER BY linea)                 AS produccion_por_linea
  FROM produccion_por_linea
  GROUP BY 1, 2, 3, 4
),

honorarios AS (
  -- Honorarios devengados = PENDIENTE + LIQUIDADO (fórmula exacta del REQ).
  SELECT
    pm."organizationId"                                           AS organization_id,
    pm."medicoAfiliadoId"                                         AS medico_afiliado_id,
    pm."establishmentId"                                          AS establishment_id,
    date_trunc('month', pm.fecha)::date                           AS period_month,
    SUM(pm."honorarioCalculado") FILTER (
      WHERE pm.estado IN ('PENDIENTE', 'LIQUIDADO')
    )                                                              AS honorarios_devengados
  FROM public."ProduccionMedica" pm
  GROUP BY 1, 2, 3, 4
),

claves AS (
  -- Unión de llaves: un afiliado puede tener renta sin producción del mes
  -- (consultorio ocioso) o producción sin contrato de arrendamiento (afiliado
  -- sin consultorio propio, AFILIADO_SIN_CONSULTORIO).
  SELECT organization_id, medico_afiliado_id, establishment_id, period_month FROM renta
  UNION
  SELECT organization_id, medico_afiliado_id, establishment_id, period_month FROM produccion
  UNION
  SELECT organization_id, medico_afiliado_id, establishment_id, period_month FROM honorarios
)

SELECT
  k.organization_id,
  k.medico_afiliado_id,
  k.establishment_id,
  k.period_month,
  COALESCE(r.renta_devengada, 0)::numeric(14, 2)                  AS renta_devengada,
  COALESCE(r.renta_cobrada, 0)::numeric(14, 2)                    AS renta_cobrada,
  COALESCE(p.produccion_total, 0)::numeric(14, 2)                 AS produccion_total,
  COALESCE(p.produccion_por_linea, '{}'::jsonb)                   AS produccion_por_linea,
  COALESCE(h.honorarios_devengados, 0)::numeric(14, 2)            AS honorarios_devengados,
  -- Fórmula exacta del REQ US.AFIL.1.8 AC1: producción - honorarios (NO neta
  -- la renta del arrendamiento, son líneas de negocio distintas).
  (COALESCE(p.produccion_total, 0) - COALESCE(h.honorarios_devengados, 0))::numeric(14, 2)
                                                                    AS margen_contribucion,
  NOW()                                                            AS calculado_en
FROM claves k
LEFT JOIN renta r
  USING (organization_id, medico_afiliado_id, establishment_id, period_month)
LEFT JOIN produccion p
  USING (organization_id, medico_afiliado_id, establishment_id, period_month)
LEFT JOIN honorarios h
  USING (organization_id, medico_afiliado_id, establishment_id, period_month);

CREATE UNIQUE INDEX uix_mv_rentabilidad_afiliado
  ON analytics.mv_rentabilidad_afiliado (organization_id, medico_afiliado_id, establishment_id, period_month);

CREATE INDEX idx_mv_rentabilidad_afiliado_period
  ON analytics.mv_rentabilidad_afiliado (period_month DESC);

CREATE INDEX idx_mv_rentabilidad_afiliado_org_estab
  ON analytics.mv_rentabilidad_afiliado (organization_id, establishment_id);

COMMENT ON MATERIALIZED VIEW analytics.mv_rentabilidad_afiliado IS
  'CC-0036 Ola 6 (US.AFIL.1.8 AC1). Grano organization_id x medico_afiliado_id
   x establishment_id x mes. produccion_por_linea es JSONB {origen: monto}
   (origen = PatientAccountService.origen). renta_cobrada siempre 0 hoy:
   ContratoCargo no produce estado PAGADO en esta fase (RESERVADO).
   margen_contribucion = produccion_total - honorarios_devengados (fórmula
   exacta del REQ, NO neta la renta). Refresh diario 03:30 UTC (pg_cron:
   analytics_rentabilidad_refresh). Acceso SOLO vía
   analytics.fn_rentabilidad_afiliado() — GRANT SELECT directo revocado.';

-- -----------------------------------------------------------------------------
-- 2. Acceso — SECURITY DEFINER filtrado por analytics.current_bi_org_id()
--    (sembrada en sql/49). Ver nota de seguridad al inicio del archivo.
-- -----------------------------------------------------------------------------

REVOKE ALL ON analytics.mv_rentabilidad_afiliado FROM PUBLIC, authenticated, anon, bi_reader;

CREATE OR REPLACE FUNCTION analytics.fn_rentabilidad_afiliado(
  p_desde date,
  p_hasta date,
  p_establishment_id uuid DEFAULT NULL
)
RETURNS SETOF analytics.mv_rentabilidad_afiliado
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = analytics, public, pg_catalog
AS $$
  SELECT *
  FROM analytics.mv_rentabilidad_afiliado
  WHERE analytics.current_bi_org_id() IS NOT NULL
    AND organization_id = analytics.current_bi_org_id()
    AND period_month >= date_trunc('month', p_desde)::date
    AND period_month <= date_trunc('month', p_hasta)::date
    AND (p_establishment_id IS NULL OR establishment_id = p_establishment_id);
$$;

COMMENT ON FUNCTION analytics.fn_rentabilidad_afiliado IS
  'Única vía de lectura de analytics.mv_rentabilidad_afiliado. Filtra por
   organization_id = analytics.current_bi_org_id() (GUC app.current_org_id,
   fijado por withTenantContext antes de llamar) — defensa en profundidad,
   no depende únicamente del WHERE del router tRPC. Devuelve 0 filas si el
   GUC no está seteado (fuera de withTenantContext).';

GRANT EXECUTE ON FUNCTION analytics.fn_rentabilidad_afiliado(date, date, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION analytics.fn_rentabilidad_afiliado(date, date, uuid) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. pg_cron — refresh nightly 03:30 UTC (patrón sql/122 kpi_falls_rate_refresh)
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  existing_job INT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'analytics_rentabilidad_refresh';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
END
$$;

SELECT cron.schedule(
  'analytics_rentabilidad_refresh',
  '30 3 * * *',
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.mv_rentabilidad_afiliado; $$
);

-- -----------------------------------------------------------------------------
-- 4. RBAC — permiso tablero_afiliado.leer (US.AFIL.1.8 es un tablero nuevo,
--    no cubierto por liquidacion.leer/produccion_medica.leer del REQ §7.1) —
--    ADMIN/DIR/GERENTE_FINANCIERO, roles ya sembrados (sql/244 §5, sql/248
--    §7). Patrón idéntico a sql/248 §7.
-- -----------------------------------------------------------------------------

INSERT INTO public."Permission" (id, code, resource, action, "createdAt")
SELECT gen_random_uuid(), v.code, v.resource, v.action, now()
FROM (VALUES
  ('tablero_afiliado.leer', 'tablero_afiliado', 'leer')
) AS v(code, resource, action)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public."RolePermission" ("roleId", "permissionId", effect)
SELECT r.id, p.id, 'ALLOW'
FROM (VALUES
  ('ADMIN', 'tablero_afiliado.leer'),
  ('DIR', 'tablero_afiliado.leer'),
  ('GERENTE_FINANCIERO', 'tablero_afiliado.leer')
) AS g(role_code, perm_code)
JOIN public."Role" r ON r.code = g.role_code
JOIN public."Permission" p ON p.code = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET effect = 'ALLOW';

COMMIT;
