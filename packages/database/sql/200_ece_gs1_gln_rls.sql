-- =====================================================================
-- 200_ece_gs1_gln_rls.sql
-- Habilita RLS en ece.gs1_gln — hoy la tabla tiene RLS DESHABILITADO y 0
-- policies (verificado: pg_class.relrowsecurity = false, 0 filas en prod).
-- Se corrige ANTES de sembrar el catálogo (0 filas hoy) porque arreglar la
-- semántica con datos dentro sale mucho más caro.
--
-- Decisión de negocio (Edwin, no se re-discute): los GLN son POR
-- ESTABLECIMIENTO, no un catálogo global — cada establecimiento tiene sus
-- propias ubicaciones físicas (depósito/farmacia/servicio/cama), colgando de
-- un GLN raíz corporativo compartido.
--
-- Namespace de GUC: esta tabla vive en el schema `ece` y su RLS lee
-- `app.ece_establecimiento_id` (ece.current_establecimiento_id_safe(),
-- definida en 65_ece_rls_hardening.sql) — NO el `app.current_org_id` que
-- setea `withTenantContext` (packages/trpc/src/rls-context.ts). El router
-- (gs1-gln-hierarchy.router.ts) fue corregido en el mismo cambio para correr
-- bajo `withEceContext` (packages/trpc/src/ece/rls-context.ts) y para setear
-- `establecimiento_id` en cada INSERT — antes quedaba NULL siempre.
--
-- Raíz de la jerarquía (el punto fino del diseño):
-- `ece.gs1_gln.establecimiento_id` es NULLABLE (168_gs1_gln_jerarquia.sql) y
-- la CTE recursiva de `tree()` arranca en `parent_id IS NULL` — si una policy
-- estricta ocultara las filas con establecimiento_id NULL, la raíz
-- corporativa desaparecería para TODOS los establecimientos y el árbol
-- quedaría vacío (parent_id apunta a un nodo que nadie puede ver). Se
-- resuelve así:
--   - SELECT: visible si establecimiento_id IS NULL (raíz corporativa
--     compartida) O pertenece al establecimiento activo. Mismo patrón que
--     ece.institucion/ece.tipo_documento en 65_ece_rls_hardening.sql, que ya
--     tratan la infraestructura compartida entre establecimientos como
--     catálogo de lectura abierta a `authenticated`.
--   - INSERT: exige establecimiento_id = establecimiento activo — nadie
--     puede, vía el router de aplicación, crear un nodo NULL (raíz) ni un
--     nodo etiquetado con el establecimiento de otro. Alta de una nueva raíz
--     corporativa (establecimiento_id NULL) queda reservada a flujos
--     administrativos con `service_role`/`demoteRole: false` (seeders),
--     igual que otros catálogos globales del schema.
--   - Sin policy de UPDATE/DELETE: el router no expone edición ni borrado de
--     GLN hoy — con RLS activo y sin policy, Postgres deniega esos comandos
--     por defecto (0 filas afectadas, sin error) para `authenticated`. El
--     REVOKE explícito de abajo deja los grants coherentes con eso.
--
-- FKs externas (10, documentadas en 168_gs1_gln_jerarquia.sql) que referencian
-- ece.gs1_gln(codigo) NO se ven afectadas: Postgres ejecuta las validaciones
-- de integridad referencial (FK) con los privilegios del dueño de la tabla,
-- bypaseando RLS — comportamiento documentado de Postgres, no una suposición
-- de este archivo (ver "Notes" en la página de CREATE POLICY). Verificado
-- también empíricamente contra Postgres nativo (ver reporte de esta migración).
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

ALTER TABLE ece.gs1_gln ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gs1_gln_select ON ece.gs1_gln;
CREATE POLICY gs1_gln_select ON ece.gs1_gln
  FOR SELECT
  TO authenticated
  USING (
    establecimiento_id IS NULL
    OR establecimiento_id = ece.current_establecimiento_id_safe()
  );

DROP POLICY IF EXISTS gs1_gln_insert ON ece.gs1_gln;
CREATE POLICY gs1_gln_insert ON ece.gs1_gln
  FOR INSERT
  TO authenticated
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id_safe());

-- Sin policy de UPDATE/DELETE para `authenticated` — ver comentario arriba.
GRANT SELECT, INSERT ON ece.gs1_gln TO authenticated;
GRANT ALL ON ece.gs1_gln TO service_role;

-- REVOKE explícito: ALTER DEFAULT PRIVILEGES IN SCHEMA ece (58_ece_schema_grants.sql
-- §5) ya había otorgado los 4 privilegios (SELECT/INSERT/UPDATE/DELETE) a
-- `authenticated` sobre esta tabla en el momento de su creación, sin importar
-- que este archivo solo declare SELECT/INSERT arriba. Sin este REVOKE el
-- GRANT de la línea anterior mentiría sobre el estado real de privilegios
-- (mismo patrón que 199_epcis_patient_movement.sql §2). `service_role` no se
-- toca — BYPASSRLS, uso administrativo/seed confiable.
REVOKE UPDATE, DELETE ON ece.gs1_gln FROM authenticated;
