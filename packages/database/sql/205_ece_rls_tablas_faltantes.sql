-- =====================================================================
-- 205_ece_rls_tablas_faltantes.sql
-- P0-3: 7 de 109 tablas del schema `ece` con RLS DESHABILITADO y 0 policies
-- (verificado contra prod 2026-08-22: relrowsecurity = false, 0 filas en
-- pg_policies, en las 7). Tablas:
--
--   ece.epcis_event             ece.epcis_event_equipment
--   ece.catalogo_cpt            ece.lasa_pair
--   ece.pediatric_max_dose      ece.workflow_estado_layout
--   ece.workflow_plantilla
--
-- ---------------------------------------------------------------------
-- CORRECCIÓN AL BRIEFING ORIGINAL — verificado con \d contra prod, no de
-- memoria: ece.epcis_event / ece.epcis_event_equipment NO son la
-- trazabilidad de MOVIMIENTO DE PACIENTE de ADR 0019. Esa tabla es
-- ece.gs1_epcis_patient_event (creada en 199_epcis_patient_movement.sql,
-- RLS YA habilitado ahí — ver ece.current_establecimiento_id_safe()).
-- Las dos tablas de este lote son el tracker de EQUIPO BIOMÉDICO
-- (equipment_id → public."BiomedicalEquipment", ver 82_equipment_gs1_extension.sql
-- y el comentario textual en 94_farmacovigilancia_epcis.sql: "ece.epcis_event
-- ya existe como tabla legacy (equipment tracker)"). Sigue siendo el
-- hallazgo de más riesgo del lote — sin RLS, cualquier tenant autenticado
-- puede leer/escribir el historial de ubicación de equipos biomédicos de
-- CUALQUIER otro establecimiento (fuga de inventario/activos entre
-- organizaciones) — pero el vector es equipo, no paciente. Ver reporte de
-- esta migración para el detalle de inspección.
-- ---------------------------------------------------------------------
--
-- CORRECCIÓN #2 (post-review de @Orq, misma sesión) — la primera versión
-- de este archivo afirmaba que ece.workflow_estado_layout era "catálogo de
-- solo lectura" y le puso REVOKE INSERT/UPDATE. Eso era FALSO: el propio
-- comentario de este archivo, dos párrafos abajo en la evidencia original,
-- ya citaba `workflow-estado.router.ts` → `estado.setLayout` haciendo
-- `INSERT ... ON CONFLICT (estado_id) DO UPDATE` en cada dragEnd del
-- Workflow Designer — y aun así se le diseñó una policy de solo-lectura.
-- Hoy no rompe nada porque ese router corre bajo el rol BYPASSRLS (no usa
-- withTenantContext), pero es una bomba de tiempo: el frente R02 está
-- migrando exactamente ese tipo de router a withTenantContext en paralelo
-- a este trabajo. Corregido en la sección 6 — ver también el re-grep
-- exhaustivo de escrituras reales (INSERT/UPDATE/DELETE) contra las 7
-- tablas, hecho con más rigor esta vez, en la evidencia de abajo.
-- ---------------------------------------------------------------------
--
-- NAMESPACE DE GUC — NO es el de `ece.*` (app.ece_establecimiento_id vía
-- ece.current_establecimiento_id_safe(), usado por gs1_gln/gs1_epcis_patient_event
-- en 199/200). Ninguna de las 7 tablas de este lote tiene columna
-- establecimiento_id. Dos espacios distintos aplican aquí:
--
--   1. epcis_event / epcis_event_equipment: heredan tenant de
--      public."BiomedicalEquipment" (organizationId + establishmentId),
--      que ya usa `public.current_org_id()` / `public.is_break_glass()`
--      — el GUC que setea `withTenantContext`
--      (packages/trpc/src/rls-context.ts), NO withEceContext. Como las
--      tablas de evento no tienen su propia columna organization_id,
--      la policy resuelve el tenant vía EXISTS contra BiomedicalEquipment
--      (mismo patrón que usan las 10 FKs externas de ece.gs1_gln descritas
--      en 200_ece_gs1_gln_rls.sql — Postgres puede indexar el filtro por
--      equipment_id, que ya tiene índice compuesto
--      idx_epcis_equip_equipment_id / idx_epcis_event_equipment_ts).
--
--   2. catalogo_cpt / lasa_pair / pediatric_max_dose / workflow_plantilla:
--      catálogos SIN columna de tenant, SIN fila alguna hoy que sugiera
--      necesitarla, y — verificado con grep exhaustivo de
--      INSERT/UPDATE/DELETE contra estas 4 tablas en TODO
--      packages/trpc/src y apps/web/src (raw SQL y también llamadas
--      Prisma vía los nombres de modelo camelCase, p.ej. eceCatalogoCpt)
--      — sin NINGÚN camino de escritura de aplicación; el único INSERT en
--      todo el repo es el seed SQL correspondiente (117/118/183), corrido
--      con un rol BYPASSRLS. Se tratan con el patrón "catalogo_read_all"
--      ya establecido en 65_ece_rls_hardening.sql para ece.tipo_documento
--      / ece.flujo_estado / ece.rol / ece.catalogo_valor: SELECT
--      USING (true) para `authenticated`, sin policy de escritura. Con
--      REVOKE explícito de INSERT/UPDATE/DELETE (refuerzo de 199/200, que
--      65 no hizo) porque `ALTER DEFAULT PRIVILEGES IN SCHEMA ece`
--      (58_ece_schema_grants.sql §5) ya había otorgado los 4 privilegios a
--      `authenticated` al crearse cada tabla, sin importar qué declare
--      este archivo.
--
--   3. workflow_estado_layout: catálogo SIN columna de tenant, PERO CON
--      escritura de aplicación real y verificada — `estado.setLayout`
--      en workflow-estado.router.ts:379-389 hace
--      `INSERT ... ON CONFLICT (estado_id) DO UPDATE`, llamado en cada
--      dragEnd del Workflow Designer visual (US.F2.2.01). No es catálogo
--      de solo lectura, es metadata de presentación (posición x/y de un
--      nodo del grafo) sin PHI ni secreto de tenant. Lleva SELECT +
--      INSERT + UPDATE abiertos a `authenticated` (ver §6 abajo) — sin
--      filtro de tenant porque no hay ninguno que aplicar (la tabla es
--      global igual que su padre flujo_estado), y sin necesidad de EXISTS
--      contra flujo_estado porque la FK `workflow_estado_layout_estado_id_fkey`
--      ya rechaza cualquier estado_id inexistente a nivel de constraint
--      (y esa FK, como toda comprobación de integridad referencial en
--      Postgres, bypasea RLS — así que el ON DELETE CASCADE de
--      `estado.delete` sigue funcionando aunque `authenticated` no tenga
--      policy de DELETE en esta tabla).
--
-- EVIDENCIA DE INSPECCIÓN (prod, psql vía DIRECT_URL, 2026-08-22):
--
--   - Las 7 tablas: relrowsecurity=false, relforcerowsecurity=false,
--     0 filas en pg_policies. Confirma el hallazgo del briefing.
--   - Filas actuales: epcis_event=0, epcis_event_equipment=0,
--     catalogo_cpt=12 (CPT estándar, ninguno con datos de paciente),
--     lasa_pair=0, pediatric_max_dose=0, workflow_estado_layout=0,
--     workflow_plantilla=0. Sin riesgo de exposición retroactiva —
--     el hardening es preventivo, no una fuga ya explotada con datos.
--   - public."BiomedicalEquipment": relrowsecurity=true, 2 policies
--     (`biomedical_equipment_tenant_select` con is_break_glass() OR
--     organizationId=current_org_id(); `biomedical_equipment_tenant_modify`
--     ALL con solo organizationId=current_org_id()). Se replica ese mismo
--     par de reglas para las dos tablas de evento de equipo.
--   - "Drug".organizationId es NULLABLE (fármacos globales conviven con
--     fármacos por organización; policy existente `drug_global_or_tenant_select`
--     permite NULL OR org match). lasa_pair y pediatric_max_dose
--     referencian Drug(id) pero NO tienen columna de tenant propia. El
--     router de aplicación que las lee
--     (packages/trpc/src/routers/medication-admin.router.ts, líneas ~461
--     y ~534) filtra únicamente por drug_id — sin filtro de organización —
--     y el ÚNICO camino de escritura a ambas tablas en todo el repo son
--     los SQL de seed 117_lasa_double_check.sql / 118_pediatric_max_dose.sql
--     (vía rol con BYPASSRLS). Son catálogos clínicos de seguridad
--     (pares LASA, dosis máxima pediátrica) tratados hoy como referencia
--     global compartida entre organizaciones — no hay evidencia de
--     intención de aislarlos por tenant. Igual con ece.catalogo_cpt: su
--     propio router (packages/trpc/src/routers/ece/cpt.router.ts) lo
--     documenta explícito como "global, sin RLS, GRANT SELECT a
--     authenticated" — ese comentario queda desactualizado por este
--     archivo (se sigue tratando como global, sólo que ahora con RLS
--     enable + policy explícita en vez de "sin RLS").
--   - RE-GREP EXHAUSTIVO DE ESCRITURAS (pedido explícito de @Orq, no
--     supuesto): `grep -rn "INSERT INTO ece\.<tabla>\|UPDATE ece\.<tabla>\|
--     DELETE FROM ece\.<tabla>"` contra TODO packages/trpc/src y
--     apps/web/src, para cada una de las 7 tablas, más un grep separado de
--     llamadas Prisma camelCase (`eceCatalogoCpt.create/update/upsert/delete`,
--     etc.) contra los modelos que sí están en schema.prisma. Resultado:
--       * ece.epcis_event            → 0 hits de escritura en código de app.
--       * ece.epcis_event_equipment  → 1 hit: services-equipment.router.ts:265
--         (`actualizarUbicacion`, procedure `tenantProcedure`). YA validado
--         arriba: la policy de INSERT (§2 abajo) exige
--         `BiomedicalEquipment.organizationId = current_org_id()`, que es
--         exactamente el mismo filtro que ese router ya aplica en JS
--         (línea ~249, `findFirst({ organizationId: ctx.tenant.organizationId })`)
--         antes del INSERT — el día que ese router migre a
--         `withTenantContext` (frente R02, en curso en paralelo a este
--         archivo), la policy no le va a romper el flujo porque el valor
--         que exige ya es el que el router garantiza hoy en aplicación.
--       * ece.catalogo_cpt           → 0 hits (ni raw SQL ni Prisma
--         `eceCatalogoCpt.*`; sólo `.findMany` de solo lectura en
--         cpt.router.ts).
--       * ece.lasa_pair               → 0 hits.
--       * ece.pediatric_max_dose      → 0 hits.
--       * ece.workflow_plantilla      → 0 hits (confirma que
--         `applyToWorkflow` no escribe en esta tabla, solo en
--         flujo_estado/flujo_transicion).
--       * ece.workflow_estado_layout  → 1 hit: workflow-estado.router.ts:383
--         (`estado.setLayout`, procedure `workflowProc` = requireRole(DIR,
--         WORKFLOW_DESIGNER)) — ver corrección #2 y §6 abajo. La primera
--         versión de este archivo YA citaba este mismo router/línea en su
--         evidencia y aun así diseñó una policy de solo-lectura — error de
--         @DBA detectado por @Orq, corregido en esta versión.
--
-- Idempotente: ENABLE ROW LEVEL SECURITY es repetible; DROP POLICY IF
-- EXISTS + CREATE POLICY; GRANT/REVOKE son declarativos.
-- NO aplicado a prod por este archivo — @DBA solo entrega el SQL, @Orq/
-- Edwin aplican vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. ece.epcis_event — tracker legacy de movimiento de equipo biomédico.
--    Tenant heredado de public."BiomedicalEquipment" vía equipment_id.
-- ---------------------------------------------------------------------------

ALTER TABLE ece.epcis_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS epcis_event_select ON ece.epcis_event;
CREATE POLICY epcis_event_select ON ece.epcis_event
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public."BiomedicalEquipment" be
       WHERE be.id = equipment_id
         AND (be."organizationId" = public.current_org_id() OR public.is_break_glass())
    )
  );

DROP POLICY IF EXISTS epcis_event_insert ON ece.epcis_event;
CREATE POLICY epcis_event_insert ON ece.epcis_event
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public."BiomedicalEquipment" be
       WHERE be.id = equipment_id
         AND be."organizationId" = public.current_org_id()
    )
  );

-- Sin policy de UPDATE/DELETE — es una bitácora de eventos, no un registro
-- editable (mismo criterio que ece.gs1_epcis_event / ece.gs1_epcis_patient_event).
-- Con RLS activo y sin policy, Postgres deniega esos comandos por defecto
-- (0 filas afectadas, sin error) para `authenticated`.
GRANT SELECT, INSERT ON ece.epcis_event TO authenticated;
GRANT ALL ON ece.epcis_event TO service_role;

-- REVOKE explícito: ALTER DEFAULT PRIVILEGES IN SCHEMA ece
-- (58_ece_schema_grants.sql §5) ya había otorgado los 4 privilegios a
-- `authenticated` al crearse la tabla. `service_role` no se toca (BYPASSRLS).
REVOKE UPDATE, DELETE ON ece.epcis_event FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2. ece.epcis_event_equipment — tracker GS1 EPCIS 2.0 de equipo biomédico
--    (superset de epcis_event: event_type/biz_step/payload). Mismo tenant
--    (equipment_id → BiomedicalEquipment) y mismo patrón.
-- ---------------------------------------------------------------------------

ALTER TABLE ece.epcis_event_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS epcis_event_equipment_select ON ece.epcis_event_equipment;
CREATE POLICY epcis_event_equipment_select ON ece.epcis_event_equipment
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public."BiomedicalEquipment" be
       WHERE be.id = equipment_id
         AND (be."organizationId" = public.current_org_id() OR public.is_break_glass())
    )
  );

DROP POLICY IF EXISTS epcis_event_equipment_insert ON ece.epcis_event_equipment;
CREATE POLICY epcis_event_equipment_insert ON ece.epcis_event_equipment
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public."BiomedicalEquipment" be
       WHERE be.id = equipment_id
         AND be."organizationId" = public.current_org_id()
    )
  );

-- Sin policy de UPDATE/DELETE — ver razón en §1.
GRANT SELECT, INSERT ON ece.epcis_event_equipment TO authenticated;
GRANT ALL ON ece.epcis_event_equipment TO service_role;
REVOKE UPDATE, DELETE ON ece.epcis_event_equipment FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. ece.catalogo_cpt — catálogo global de procedimientos CPT (12 filas,
--    estándar internacional, sin columna de tenant). Solo lectura para
--    `authenticated`; escritura únicamente vía seed (183_cc0007_catalogo_cpt_plantilla.sql)
--    con rol BYPASSRLS. Mismo patrón que ece.tipo_documento (65_ece_rls_hardening.sql).
-- ---------------------------------------------------------------------------

ALTER TABLE ece.catalogo_cpt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogo_read_all ON ece.catalogo_cpt;
CREATE POLICY catalogo_read_all ON ece.catalogo_cpt
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON ece.catalogo_cpt TO authenticated;
GRANT ALL ON ece.catalogo_cpt TO service_role;

-- REVOKE explícito (defensa en profundidad, patrón 199/200): sin policy de
-- escritura para `authenticated`, INSERT/UPDATE/DELETE ya quedan denegados
-- por RLS: el REVOKE deja los grants coherentes con eso.
REVOKE INSERT, UPDATE, DELETE ON ece.catalogo_cpt FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. ece.lasa_pair — catálogo clínico de pares LASA (look-alike/sound-alike)
--    referenciado por drug_a_id/drug_b_id, sin columna de tenant. "Drug" sí
--    admite organizationId NULL (fármaco global) — la seguridad LASA es
--    propiedad del par de fármacos, no del tenant que los prescribe. El
--    único camino de escritura es el seed (117_lasa_double_check.sql).
--    Solo lectura para `authenticated`.
-- ---------------------------------------------------------------------------

ALTER TABLE ece.lasa_pair ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogo_read_all ON ece.lasa_pair;
CREATE POLICY catalogo_read_all ON ece.lasa_pair
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON ece.lasa_pair TO authenticated;
GRANT ALL ON ece.lasa_pair TO service_role;
REVOKE INSERT, UPDATE, DELETE ON ece.lasa_pair FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. ece.pediatric_max_dose — catálogo clínico de dosis máxima pediátrica
--    por fármaco (JCI IPSG.3 ME 5). Mismo razonamiento que lasa_pair: sin
--    columna de tenant, único camino de escritura es el seed
--    (118_pediatric_max_dose.sql). Solo lectura para `authenticated`.
-- ---------------------------------------------------------------------------

ALTER TABLE ece.pediatric_max_dose ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogo_read_all ON ece.pediatric_max_dose;
CREATE POLICY catalogo_read_all ON ece.pediatric_max_dose
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON ece.pediatric_max_dose TO authenticated;
GRANT ALL ON ece.pediatric_max_dose TO service_role;
REVOKE INSERT, UPDATE, DELETE ON ece.pediatric_max_dose FROM authenticated;

-- ---------------------------------------------------------------------------
-- 6. ece.workflow_estado_layout — posiciones x/y del grafo del Workflow
--    Designer (US.F2.2.01), 1:1 con ece.flujo_estado (catálogo global,
--    solo-lectura desde 65_ece_rls_hardening.sql). Sin columna de tenant.
--
--    CORREGIDO (ver "CORRECCIÓN #2" al inicio del archivo): a diferencia de
--    flujo_estado, esta tabla SÍ tiene escritura real de aplicación —
--    `estado.setLayout` en workflow-estado.router.ts:379-389 hace
--    `INSERT ... ON CONFLICT (estado_id) DO UPDATE SET x=..., y=...`,
--    llamado en cada dragEnd del Workflow Designer visual. Hoy ese router
--    corre bajo el rol BYPASSRLS (no usa withTenantContext), pero el
--    frente R02 lo está migrando en paralelo — poner esta tabla en
--    solo-lectura (como se hizo en la primera versión de este archivo)
--    habría roto el guardado de posiciones del diseñador en cuanto ese
--    router se demote a `authenticated`.
--
--    Es metadata de presentación (coordenadas x/y de un nodo del grafo)
--    sin PHI ni secreto de tenant — igual que su padre flujo_estado, no
--    hay ningún filtro de tenant que aplicar, así que SELECT/INSERT/UPDATE
--    quedan abiertos a `authenticated` sin USING/WITH CHECK adicional más
--    allá de `true`. No hace falta un EXISTS contra flujo_estado: la FK
--    `workflow_estado_layout_estado_id_fkey` ya rechaza cualquier
--    estado_id inexistente a nivel de constraint, y las comprobaciones de
--    integridad referencial en Postgres bypasean RLS siempre — por eso el
--    `ON DELETE CASCADE` de esa FK sigue funcionando cuando `estado.delete`
--    borra un flujo_estado, aunque `authenticated` no tenga policy de
--    DELETE en esta tabla (no hay endpoint de aplicación que la necesite;
--    ver re-grep en la evidencia — 0 hits de DELETE).
-- ---------------------------------------------------------------------------

ALTER TABLE ece.workflow_estado_layout ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogo_read_all ON ece.workflow_estado_layout;
CREATE POLICY catalogo_read_all ON ece.workflow_estado_layout
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT + UPDATE (no solo INSERT): `estado.setLayout` usa
-- `INSERT ... ON CONFLICT (estado_id) DO UPDATE`, y ese camino de
-- conflicto se ejecuta como una operación de UPDATE — requiere policy de
-- UPDATE además de la de INSERT o el upsert falla en el caso de conflicto
-- (la ruta más común, ya que estado_id es PK y el diseñador reposiciona
-- nodos existentes en cada dragEnd).
DROP POLICY IF EXISTS workflow_estado_layout_insert ON ece.workflow_estado_layout;
CREATE POLICY workflow_estado_layout_insert ON ece.workflow_estado_layout
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS workflow_estado_layout_update ON ece.workflow_estado_layout;
CREATE POLICY workflow_estado_layout_update ON ece.workflow_estado_layout
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Sin policy de DELETE para `authenticated` — no hay endpoint de
-- aplicación que borre filas directamente (0 hits en el re-grep). El
-- ON DELETE CASCADE de la FK a flujo_estado sigue funcionando igual
-- (bypasea RLS, ver comentario arriba).
GRANT SELECT, INSERT, UPDATE ON ece.workflow_estado_layout TO authenticated;
GRANT ALL ON ece.workflow_estado_layout TO service_role;
REVOKE DELETE ON ece.workflow_estado_layout FROM authenticated;

-- ---------------------------------------------------------------------------
-- 7. ece.workflow_plantilla — biblioteca de plantillas de workflow
--    (US.F2.2.09-10). Sin columna de tenant. El único router que la toca
--    (workflow-plantilla.router.ts) solo hace SELECT sobre ella;
--    `applyToWorkflow` escribe en flujo_estado/flujo_transicion, nunca en
--    esta tabla — confirmado con el re-grep exhaustivo (0 hits de
--    INSERT/UPDATE/DELETE contra workflow_plantilla en todo
--    packages/trpc/src y apps/web/src). Catálogo de solo lectura real
--    para `authenticated`, a diferencia de workflow_estado_layout (§6).
-- ---------------------------------------------------------------------------

ALTER TABLE ece.workflow_plantilla ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogo_read_all ON ece.workflow_plantilla;
CREATE POLICY catalogo_read_all ON ece.workflow_plantilla
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON ece.workflow_plantilla TO authenticated;
GRANT ALL ON ece.workflow_plantilla TO service_role;
REVOKE INSERT, UPDATE, DELETE ON ece.workflow_plantilla FROM authenticated;

-- =====================================================================
-- VERIFICACIÓN POST-APLICACIÓN (correr manualmente contra prod después
-- de aplicar; no se ejecuta como parte de este archivo).
-- =====================================================================

-- 1. Las 7 tablas deben quedar con relrowsecurity = true:
--
-- SELECT relname, relrowsecurity
--   FROM pg_class
--  WHERE relnamespace = 'ece'::regnamespace
--    AND relname IN ('epcis_event', 'epcis_event_equipment', 'catalogo_cpt',
--                     'lasa_pair', 'pediatric_max_dose',
--                     'workflow_estado_layout', 'workflow_plantilla');
-- -- esperado: relrowsecurity = t en las 7 filas.

-- 2. Cada tabla debe tener al menos la policy de SELECT esperada:
--
-- SELECT schemaname, tablename, policyname, cmd
--   FROM pg_policies
--  WHERE schemaname = 'ece'
--    AND tablename IN ('epcis_event', 'epcis_event_equipment', 'catalogo_cpt',
--                       'lasa_pair', 'pediatric_max_dose',
--                       'workflow_estado_layout', 'workflow_plantilla')
--  ORDER BY tablename, cmd;
-- -- esperado: epcis_event/epcis_event_equipment → SELECT+INSERT;
-- -- workflow_estado_layout → SELECT+INSERT+UPDATE;
-- -- catalogo_cpt/lasa_pair/pediatric_max_dose/workflow_plantilla → SELECT únicamente.

-- 3. Grants de `authenticated` esperados por tabla:
--
-- SELECT table_name, privilege_type
--   FROM information_schema.role_table_grants
--  WHERE table_schema = 'ece'
--    AND grantee = 'authenticated'
--    AND table_name IN ('epcis_event', 'epcis_event_equipment', 'catalogo_cpt',
--                        'lasa_pair', 'pediatric_max_dose',
--                        'workflow_estado_layout', 'workflow_plantilla')
--  ORDER BY table_name, privilege_type;
-- -- esperado:
-- --   epcis_event / epcis_event_equipment  → {INSERT, SELECT}
-- --   workflow_estado_layout               → {INSERT, SELECT, UPDATE}
-- --   catalogo_cpt / lasa_pair /
-- --   pediatric_max_dose / workflow_plantilla → {SELECT} únicamente

-- 4. Advisor de Supabase no debe seguir marcando estas 7 tablas en
--    `rls_disabled_in_public` / hallazgo equivalente para `ece`
--    (usar mcp__supabase__get_advisors tipo "security").

-- 5. Correr mcp__supabase__get_advisors (tipo "security" y "performance")
--    después de aplicar, para confirmar que no aparecen hallazgos nuevos
--    (p.ej. `auth_rls_initplan` por el EXISTS de las policies de
--    epcis_event/epcis_event_equipment) además de que desaparecen los 7
--    hallazgos `rls_disabled_in_public` que motivaron este archivo.
