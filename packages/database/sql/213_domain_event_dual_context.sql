-- =============================================================================
-- 213_domain_event_dual_context.sql
-- Fix del hallazgo "public.DomainEvent = 0 filas en prod" (verificado vía MCP
-- 2026-08-26, ver docs/CC/0026 y cabecera de sql/209_cc0026_care_task.sql).
--
-- -----------------------------------------------------------------------------
-- DIAGNÓSTICO (confirmado leyendo packages/database/src/outbox/emit.ts +
-- packages/trpc/src/ece/rls-context.ts + packages/trpc/src/workflow/context.ts)
-- -----------------------------------------------------------------------------
-- `emitDomainEvent()` (packages/database/src/outbox/emit.ts) hace, dentro de
-- la MISMA transacción del caller, dos escrituras encadenadas:
--
--   1. `tx.domainEvent.create(...)` — protegido por la policy
--      `domain_event_tenant_insert` (sql/42), que exige
--      "organizationId" = public.current_org_id().
--   2. Si (1) tuvo éxito, un INSERT de auditoría — o bien vía la función
--      SECURITY DEFINER `audit.fn_write_manual_audit_entry` (sql/206) cuando
--      la sonda `public.current_org_id() IS NOT NULL` da true, o bien un
--      INSERT directo a `audit."AuditLog"` (rol privilegiado, sin demote)
--      cuando da false.
--
-- Ambos puntos asumen que el ÚNICO espacio de GUC posible es
-- `app.current_org_id` (el que setea `withTenantContext`,
-- packages/trpc/src/rls-context.ts). Pero la mayoría de los ~55 call-sites
-- de `emitDomainEvent` en `packages/trpc/src/routers/**` corren dentro de
-- transacciones ECE — `withEceContext` (packages/trpc/src/ece/rls-context.ts)
-- o `withWorkflowContext` (packages/trpc/src/workflow/context.ts) — que
-- demotan el rol a `authenticated` pero SOLO setean
-- `app.ece_personal_id` / `app.ece_establecimiento_id`. `app.current_org_id`
-- queda NULL. Es la misma "trampa de los dos espacios de GUC" documentada en
-- la cabecera de sql/209_cc0026_care_task.sql, aplicada aquí a DOS objetos
-- distintos:
--
--   A. La policy `domain_event_tenant_insert` deniega el INSERT del propio
--      evento (RLS violation, no silenciosa: Postgres lanza
--      `insufficient_privilege`/42501). Como `emitDomainEvent` no atrapa el
--      error, propaga al caller — y como la mayoría de los call-sites NO
--      envuelven el `await emitDomainEvent(...)` en try/catch (es outbox
--      transaccional: si falla, la transacción de negocio completa debe
--      revertir con ella), la firma/creación del documento ECE entero
--      revierte. `firmar()` en indicaciones-medicas.router.ts es la única
--      excepción — Ola 2b (packages/trpc/src/routers/ece/
--      indicaciones-medicas.router.ts línea ~871) ya pasa `tenantContext` a
--      `withEceContext`, lo que setea AMBOS espacios en la misma tx y evita
--      el problema ahí. Los demás ~50 call-sites ECE no lo hacen.
--   B. Aun si (A) se resolviera solo para un call-site puntual, la sonda de
--      `emitDomainEvent` (línea ~144 de emit.ts) y el propio
--      `audit.fn_write_manual_audit_entry` (sql/206) siguen leyendo
--      EXCLUSIVAMENTE `public.current_org_id()`. Bajo un contexto ECE puro
--      eso sigue dando NULL, así que la sonda cae a la rama "rol
--      privilegiado" (`tx.auditLog.create(...)` directo) — pero el rol SÍ
--      está demotado a `authenticated`, que sql/206 dejó explícitamente sin
--      GRANT INSERT sobre `audit."AuditLog"`. El INSERT directo revienta con
--      `insufficient_privilege`, revirtiendo también el DomainEvent que (A)
--      hubiera dejado insertar.
--
-- Precedente ya resuelto para el mismo problema en OTRA tabla: sql/209 creó
-- `public.current_org_id_or_ece_context()` (SECURITY DEFINER, resuelve
-- organizationId desde CUALQUIERA de los dos espacios de GUC) para que
-- `public."CareTask"` funcionara desde ambos. Ese resolver es explícitamente
-- reusable ("Reusable por otras tablas public.* que necesiten el mismo doble
-- soporte" — comentario de la función en sql/209). Este archivo lo reusa
-- para (A) DomainEvent y (B) fn_write_manual_audit_entry — sin crear un
-- segundo resolver.
--
-- -----------------------------------------------------------------------------
-- FIX
-- -----------------------------------------------------------------------------
--   A. `domain_event_tenant_select` / `domain_event_tenant_insert`:
--      "organizationId" = public.current_org_id_or_ece_context() en vez de
--      current_org_id(). UPDATE (`domain_event_service_update`, solo
--      service_role) no se toca — no le aplica el problema.
--   B. `audit.fn_write_manual_audit_entry`: el chequeo de tenant de sesión
--      usa current_org_id_or_ece_context() en vez de current_org_id(). El
--      resto de la función (identidad SIEMPRE de current_user_id(), nunca de
--      un parámetro) no cambia — sigue siendo no falsificable.
--
-- Cambio de TypeScript acompañante (NO en este archivo — coordina el frente
-- que toca packages/database/src/outbox/emit.ts): la sonda
-- `hasTenantContext` pasa de `public.current_org_id()` a
-- `public.current_org_id_or_ece_context()`.
--
-- Qué NO cambia: llamadas fuera de cualquier contexto demotado (rol
-- privilegiado/BYPASSRLS puro, p.ej. break-glass.router.ts o
-- workflow-instance.router.ts que usan `ctx.prisma.$transaction` sin pasar
-- por withTenantContext/withEceContext/withWorkflowContext) siguen
-- funcionando igual que hoy: BYPASSRLS ignora las policies de todos modos, y
-- la sonda seguirá dando NULL→NULL (ninguno de los dos espacios está
-- seteado), cayendo a la rama de INSERT directo con el rol privilegiado,
-- comportamiento sin cambios.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- NO aplicado a prod por este archivo — pendiente de review de @Orq.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. RLS de public."DomainEvent" — dual-context.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS domain_event_tenant_select ON public."DomainEvent";
CREATE POLICY domain_event_tenant_select
  ON public."DomainEvent"
  FOR SELECT
  TO authenticated
  USING ("organizationId" = public.current_org_id_or_ece_context());

DROP POLICY IF EXISTS domain_event_tenant_insert ON public."DomainEvent";
CREATE POLICY domain_event_tenant_insert
  ON public."DomainEvent"
  FOR INSERT
  TO authenticated
  WITH CHECK ("organizationId" = public.current_org_id_or_ece_context());

-- domain_event_service_update (UPDATE, solo service_role) no se toca.

-- -----------------------------------------------------------------------------
-- B. audit.fn_write_manual_audit_entry — dual-context en el chequeo de
--    tenant de sesión. Mismo cuerpo que sql/206 salvo esa línea.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit.fn_write_manual_audit_entry(
  p_organization_id  uuid,
  p_action            public."AuditAction",
  p_entity            text,
  p_entity_id         text,
  p_justification     text DEFAULT NULL,
  p_before_json       jsonb DEFAULT NULL,
  p_after_json        jsonb DEFAULT NULL,
  p_establishment_id  uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, audit, pg_catalog
AS $$
DECLARE
  v_session_org_id uuid;
  v_user_id        uuid;
  v_ip             inet;
  v_user_agent     text;
  v_new_id         bigint;
BEGIN
  IF p_entity IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'audit.fn_write_manual_audit_entry: entity/entityId son obligatorios';
  END IF;

  -- Tenant: 213 — ahora resuelve desde CUALQUIERA de los dos espacios de GUC
  -- (withTenantContext vía current_org_id(), o withEceContext/
  -- withWorkflowContext vía current_org_id_or_ece_context() cayendo a la
  -- rama ece.establecimiento -> public."Establishment"). Sigue exigiendo
  -- contexto activo por alguno de los dos caminos — no se admite invocarla
  -- "a secas" sin haber pasado por uno de los helpers de contexto.
  v_session_org_id := public.current_org_id_or_ece_context();
  IF v_session_org_id IS NULL THEN
    RAISE EXCEPTION
      'audit.fn_write_manual_audit_entry: requiere contexto de tenant activo (app.current_org_id o app.ece_establecimiento_id) — llamar dentro de withTenantContext/withEceContext/withWorkflowContext.';
  END IF;
  IF p_organization_id IS NULL OR v_session_org_id <> p_organization_id THEN
    RAISE EXCEPTION
      'audit.fn_write_manual_audit_entry: organizationId (%) no coincide con el tenant de la sesión (%)',
      p_organization_id, v_session_org_id;
  END IF;

  -- Identidad: SIEMPRE se deriva de la sesión, nunca de un parámetro del
  -- caller — cierra el vector "authenticated firma una entrada a nombre de
  -- otro usuario". Mismo criterio que audit.fn_audit_row(). Sin cambios vs
  -- sql/206: bajo contexto ECE puro, current_user_id() puede ser NULL si el
  -- caller no pasó tenantContext — la fila queda con userId NULL, igual que
  -- ya ocurre hoy cuando emittedById no se provee (columna nullable).
  v_user_id    := public.current_user_id();
  v_ip         := nullif(current_setting('request.headers.x-forwarded-for', true), '')::inet;
  v_user_agent := nullif(current_setting('request.headers.user-agent', true), '');

  INSERT INTO audit."AuditLog" (
    "occurredAt", "userId", "organizationId", "establishmentId",
    "ip", "userAgent", "action", "entity", "entityId",
    "beforeJson", "afterJson", "justification"
  )
  VALUES (
    now(), v_user_id, p_organization_id, p_establishment_id,
    v_ip, v_user_agent, p_action, p_entity, p_entity_id,
    p_before_json, p_after_json, p_justification
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION audit.fn_write_manual_audit_entry(
  uuid, public."AuditAction", text, text, text, jsonb, jsonb, uuid
) IS
  '213 — único camino de escritura para audit.AuditLog desde el rol '
  'demotado authenticated. SECURITY DEFINER: userId sale de '
  'public.current_user_id() (nunca de un parámetro — no falsificable) y '
  'organizationId debe coincidir con public.current_org_id_or_ece_context() '
  'de la sesión (no falsificable el tenant, dual-espacio: withTenantContext '
  'o withEceContext/withWorkflowContext). authenticated NO tiene GRANT '
  'INSERT directo sobre audit."AuditLog" — solo EXECUTE sobre esta función.';

REVOKE ALL ON FUNCTION audit.fn_write_manual_audit_entry(
  uuid, public."AuditAction", text, text, text, jsonb, jsonb, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION audit.fn_write_manual_audit_entry(
  uuid, public."AuditAction", text, text, text, jsonb, jsonb, uuid
) TO authenticated;

REVOKE INSERT ON audit."AuditLog" FROM authenticated;

-- -----------------------------------------------------------------------------
-- Verificación
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'DomainEvent'
      AND policyname IN ('domain_event_tenant_select', 'domain_event_tenant_insert')
  ) = 2,
    'ERROR: se esperaban las 2 policies dual-context en DomainEvent';
  ASSERT (
    SELECT count(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'audit' AND p.proname = 'fn_write_manual_audit_entry'
  ) = 1,
    'ERROR: audit.fn_write_manual_audit_entry no existe';
  RAISE NOTICE 'OK: DomainEvent dual-context + fn_write_manual_audit_entry actualizados';
END $$;
