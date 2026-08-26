-- =============================================================================
-- 209_cc0026_care_task.sql
-- CC-0026 D1 — CareTask: tarea persistida generada al firmar una indicación
-- médica (o al crear una orden de lab/imágenes/traslado) para seguimiento
-- por área/rol. Alimenta los tableros `/tableros/[unidad]` (Ola 3, fuera de
-- alcance de este archivo) y el tablero de enfermería (filtro por rol,
-- transversal a unidades).
--
-- Ver docs/CC/0026/REQ-CC-0026-indicacion-tareas-tableros.md — decisión D1.
--
-- -----------------------------------------------------------------------------
-- LA TRAMPA DE LOS DOS ESPACIOS DE GUC (leer antes de tocar las policies)
-- -----------------------------------------------------------------------------
-- El INSERT real de CareTask va a ocurrir dentro de `firmar()` en
-- indicaciones-medicas.router.ts, que corre bajo `withEceContext` (ver
-- packages/trpc/src/ece/rls-context.ts): esa función setea
--   app.ece_personal_id, app.ece_establecimiento_id
-- vía `ece.set_ece_context(personal_id, establecimiento_id)` y demota a
-- `authenticated` — pero NUNCA setea `app.current_org_id` (ese GUC es
-- exclusivo de `withTenantContext`, packages/trpc/src/rls-context.ts). Una
-- policy que solo comparara `"organizationId" = public.current_org_id()`
-- vería NULL y dejaría el INSERT en deny-all silencioso — el mismo patrón
-- que ya dejó `public."DomainEvent"` en 0 filas en prod (ver comentario de
-- sql/206_audit_write_path.sql: "el outbox NUNCA se completó de punta a
-- punta" — firmar() jamás corrió con éxito hasta hoy).
--
-- Evidencia de qué setea realmente `ece.set_ece_context` (packages/database/
-- sql/62_ece_07_rls.sql líneas 21-35, reafirmado en 62b/65):
--   PERFORM set_config('app.ece_personal_id', ...);
--   PERFORM set_config('app.ece_establecimiento_id', ...);
-- — SOLO esos dos GUC. `app.ece_establecimiento_id` NO es
-- `public."Establishment".id`: es el id de `ece.establecimiento`, una tabla
-- catálogo NTEC propia con FK NULLABLE `establishment_id` hacia el golden
-- record `public."Establishment"` (packages/database/sql/56_ece_01_catalogos.sql
-- líneas 64-78; confirmado también en el JSDoc de `eceIds()` en
-- indicaciones-medicas.router.ts líneas 296-303: "Resuelve el establecimiento
-- al espacio ece.establecimiento — son PKs distintas").
--
-- Precedente ya usado en el corpus para resolver esta misma cadena
-- (ece.establecimiento.establishment_id → public."Establishment".organizationId)
-- desde una policy de una tabla que vive fuera de `ece`: sql/188 (CC-0012,
-- policy `by_cuenta_estab` sobre `ece.signos_vitales`, líneas 156-169):
--   JOIN ece.establecimiento est ON est.id = ece.current_establecimiento_id_safe()
--   JOIN public."Establishment" e ON e.id = est.establishment_id
--   WHERE e."organizationId" = <organizationId de la fila>
--
-- Diferencia con 188: acá la tabla protegida (`CareTask`) vive en `public`,
-- no en `ece`, y ambas tablas que resuelven la cadena (`ece.establecimiento`,
-- `public."Establishment"`) YA tienen RLS habilitado con policies que
-- exigen exactamente el GUC que NO está seteado en este contexto
-- (`establecimiento_by_ctx` compara contra `current_establecimiento_id_safe()`
-- — eso sí aplica bien — pero `public."Establishment"` usa el patrón
-- genérico `tenant_isolation_select` de sql/01_rls_policies.sql, que exige
-- `app.current_org_id`, AUSENTE en este contexto). Si el resolver corriera
-- como invoker (`authenticated`), el JOIN a `public."Establishment"` vería 0
-- filas y el resolver devolvería NULL incluso con el establecimiento
-- correcto. Por eso el helper de abajo es SECURITY DEFINER — mismo patrón
-- que `audit.fn_write_manual_audit_entry` (sql/206) y
-- `ece.fn_depende_de_efectivo`: función de solo-lectura, sin parámetros
-- controlados por el caller (lee el GUC de la transacción, no un argumento),
-- `SET search_path` fijo, `EXECUTE` otorgado solo a `authenticated`.
--
-- Resultado: las policies de CareTask combinan AMBOS espacios con OR —
-- funcionan tanto si el caller vino por `withTenantContext` (tableros,
-- futuras Olas) como por `withEceContext` (firmar(), Ola 2).
-- -----------------------------------------------------------------------------
-- Otras decisiones de este archivo:
--   - Vocabulario cerrado (status/priority/sourceType) vía CHECK inline —
--     NO enum de Postgres (consistente con el resto de columnas "varchar +
--     CHECK" de la BD, p.ej. ImagingRequest.prioridad en sql/192).
--   - FKs SOLO a las 6 tablas explícitas del contrato (Organization,
--     Establishment, ServiceUnit, Encounter, Patient, PatientAccount).
--     `assigneeId`/`completedById`/`createdBy` quedan uuid SIN FK a
--     public."User" — no estaba en el contrato, y source/sourceId son
--     polimórficos por diseño (no hay una tabla única a la que apuntar).
--   - SIN trigger de auditoría — bloqueante conocido de `audit."AuditLog"`
--     (authenticated no tiene INSERT, sql/206). Ver comentario en el
--     `COMMENT ON TABLE` de abajo.
--   - SIN trigger de updatedAt — Prisma gestiona `@updatedAt` a nivel ORM en
--     cada `tx.careTask.update()`; el DEFAULT now() a nivel columna solo
--     cubre el INSERT (mismo patrón que ImagingRequest, sql/192).
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- NO aplicado a prod por este archivo — pendiente de review de @Orq.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabla
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."CareTask" (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"   uuid        NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "establishmentId"  uuid        NOT NULL REFERENCES public."Establishment"(id) ON DELETE RESTRICT,
  "serviceUnitId"    uuid        REFERENCES public."ServiceUnit"(id) ON DELETE SET NULL,
  "assignedRoleCode" varchar(40) NOT NULL,
  "assigneeId"       uuid,
  "patientId"        uuid        REFERENCES public."Patient"(id) ON DELETE SET NULL,
  "encounterId"      uuid        REFERENCES public."Encounter"(id) ON DELETE SET NULL,
  "patientAccountId" uuid        REFERENCES public."PatientAccount"(id) ON DELETE SET NULL,
  "sourceType"       varchar(30) NOT NULL
                       CHECK ("sourceType" IN ('INDICACION_ITEM', 'LAB_ORDER', 'IMAGING_ORDER', 'TRANSFER', 'MANUAL')),
  "sourceId"         uuid        NOT NULL,
  "taskType"         varchar(60) NOT NULL,
  title              varchar(200) NOT NULL,
  description        text,
  priority           varchar(10) NOT NULL DEFAULT 'NORMAL'
                       CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  "slaMinutes"       int,
  "dueAt"            timestamptz,
  status             varchar(20) NOT NULL DEFAULT 'PENDIENTE'
                       CHECK (status IN ('PENDIENTE', 'EN_PROCESO', 'CUMPLIDA', 'CANCELADA')),
  "completedById"    uuid,
  "completedAt"      timestamptz,
  "cancelReason"     varchar(300),
  "createdBy"        uuid        NOT NULL,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."CareTask" IS
  'CC-0026 D1 — tarea de primera clase generada al firmar una indicación médica '
  'u orden de lab/imágenes/traslado, para seguimiento por área/rol. '
  'SIN trigger de auditoría: authenticated no tiene INSERT sobre audit."AuditLog" '
  '(bloqueante P0-0, sql/206_audit_write_path.sql) y el INSERT de CareTask corre '
  'dentro de transacciones demotadas (withEceContext en firmar()) que no pueden '
  'asumir ese grant. Retomar cuando 206 se generalice a más call-sites.';

COMMENT ON COLUMN public."CareTask"."sourceType" IS
  'Origen polimórfico junto con "sourceId" — NO es FK (apunta a filas de '
  'ece.indicacion_item, LabOrder, ImagingOrder u otras según el valor).';

COMMENT ON COLUMN public."CareTask"."assigneeId" IS
  'Usuario específico opcional (public."User".id) — sin FK: fuera del contrato '
  'explícito de sql/209 (solo Organization/Establishment/ServiceUnit/Encounter/'
  'Patient/PatientAccount llevan FK en esta tabla).';

-- -----------------------------------------------------------------------------
-- 2. Índices para tableros
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_care_task_org_unit_status
  ON public."CareTask" ("organizationId", "serviceUnitId", status);

CREATE INDEX IF NOT EXISTS idx_care_task_org_role_status
  ON public."CareTask" ("organizationId", "assignedRoleCode", status);

CREATE INDEX IF NOT EXISTS idx_care_task_source
  ON public."CareTask" ("sourceType", "sourceId");

CREATE INDEX IF NOT EXISTS idx_care_task_encounter
  ON public."CareTask" ("encounterId")
  WHERE "encounterId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_care_task_due_pending
  ON public."CareTask" ("dueAt")
  WHERE status = 'PENDIENTE';

-- -----------------------------------------------------------------------------
-- 3. Resolver de organización para el espacio de GUC ECE (ver docstring arriba).
--    SECURITY DEFINER: necesita leer ece.establecimiento y
--    public."Establishment" sin que las RLS de esas dos tablas (que exigen
--    justo los GUC que este contexto no tiene) las vacíen.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_id_or_ece_context()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, ece, pg_catalog
AS $$
  SELECT coalesce(
    public.current_org_id(),
    (
      SELECT e."organizationId"
      FROM ece.establecimiento est
      JOIN public."Establishment" e ON e.id = est.establishment_id
      WHERE est.id = ece.current_establecimiento_id_safe()
    )
  );
$$;

COMMENT ON FUNCTION public.current_org_id_or_ece_context() IS
  'CC-0026 — resuelve organizationId desde CUALQUIERA de los dos espacios de '
  'GUC del proyecto: app.current_org_id (withTenantContext) o '
  'app.ece_establecimiento_id (withEceContext, resuelto vía '
  'ece.establecimiento.establishment_id -> public."Establishment".organizationId). '
  'SECURITY DEFINER porque el segundo camino requiere leer dos tablas cuyas '
  'propias RLS exigen el GUC que este contexto no tiene. Reusable por otras '
  'tablas public.* que necesiten el mismo doble soporte (ver CLAUDE.md — '
  'trampa de los dos espacios de GUC, documentada 2026-08-18).';

REVOKE ALL ON FUNCTION public.current_org_id_or_ece_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_org_id_or_ece_context() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. RLS — SELECT/INSERT/UPDATE para authenticated. Sin policy de DELETE
--    (las tareas se cancelan vía status='CANCELADA', no se borran) y sin
--    GRANT DELETE (ver sección 5).
-- -----------------------------------------------------------------------------
ALTER TABLE public."CareTask" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS care_task_tenant_select ON public."CareTask";
CREATE POLICY care_task_tenant_select ON public."CareTask"
  FOR SELECT
  TO authenticated
  USING ("organizationId" = public.current_org_id_or_ece_context());

DROP POLICY IF EXISTS care_task_tenant_insert ON public."CareTask";
CREATE POLICY care_task_tenant_insert ON public."CareTask"
  FOR INSERT
  TO authenticated
  WITH CHECK ("organizationId" = public.current_org_id_or_ece_context());

DROP POLICY IF EXISTS care_task_tenant_update ON public."CareTask";
CREATE POLICY care_task_tenant_update ON public."CareTask"
  FOR UPDATE
  TO authenticated
  USING ("organizationId" = public.current_org_id_or_ece_context())
  WITH CHECK ("organizationId" = public.current_org_id_or_ece_context());

-- DELETE: sin policy → bloqueado para authenticated y service_role no-owner.

-- -----------------------------------------------------------------------------
-- 5. GRANTs — sin DELETE. `anon` no recibe nada (patrón sql/152).
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public."CareTask" TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Verificación
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT (SELECT to_regclass('public."CareTask"') IS NOT NULL),
    'ERROR: CareTask no se creó';
  ASSERT (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'CareTask'
  ) = 3,
    'ERROR: se esperaban 3 policies (select/insert/update) en CareTask';
  RAISE NOTICE 'OK: CareTask + índices + resolver dual-GUC + RLS creados';
END $$;
