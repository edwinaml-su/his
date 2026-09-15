-- ============================================================================
-- 238b_cc0031_sla_watchdog.sql
-- CC-0031 Fase 3 — columnas de guarda + cron `caretask_sla_watchdog`.
--
-- ⚠️ PENDIENTE DE APLICAR — NO se aplicó a prod desde este agente (mismo
-- criterio que sql/238; lo aplica @Orq vía MCP Supabase). Requiere sql/238
-- aplicado primero (roles/alias que resuelve `fn_cc0031_escalation_role`).
--
-- Patrón: espejo de sql/114 (critical_result_sla_watchdog) y sql/120
-- (morse_sla_watchdog), pero con idempotencia por COLUMNA de guarda en vez de
-- ventana de tiempo (`occurredAt > NOW() - INTERVAL '1 hour'`) — sql/114/120
-- pueden re-emitir si el cron se atrasa más de esa ventana; acá NO, porque
-- `slaWarningEmittedAt`/`slaExceededEmittedAt` quedan seteados para siempre
-- una vez emitido el umbral correspondiente para esa tarea.
--
-- Umbrales (criterio de aceptación #4 de CC-0031):
--   70% del SLA transcurrido (createdAt → dueAt) → `task.sla_warning`.
--   100% (now() >= dueAt)                        → `task.sla_exceeded`,
--     notificado al ROL ESCALADO (`fn_cc0031_escalation_role`), no al rol
--     asignado original — así el supervisor se entera sin que la tarea
--     desaparezca de la bandeja del rol original.
--
-- Solo aplica a tareas con `slaMinutes`/`dueAt` poblados (CC-0031 Fase 3(a)
-- — LAB_TO_PROCESS/IMAGING_TO_PERFORM ya los poblaban desde CC-0026;
-- IND_* los pobló `care-task-consumer.ts` en este mismo cambio) y NO
-- CUMPLIDA/CANCELADA.
-- ============================================================================

ALTER TABLE public."CareTask"
  ADD COLUMN IF NOT EXISTS "slaWarningEmittedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "slaExceededEmittedAt" TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Espejo SQL de `ESCALATION_ROLE_BY_ASSIGNED_ROLE`
-- (packages/contracts/src/schemas/notification-roles.ts) — MANTENER EN
-- PARIDAD: si agregas/cambias una entrada en un lado, agrégala en el otro.
-- STABLE (mismo criterio que ece.fn_depende_de_efectivo): sin side-effects,
-- Postgres puede cachear el resultado dentro de la misma query.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_cc0031_escalation_role(assigned_role_code TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE assigned_role_code
    WHEN 'NURSE'            THEN 'ADMIN_CLINICO'
    WHEN 'ENF_NRP'          THEN 'ADMIN_CLINICO'
    WHEN 'TRIAGE_NURSE'     THEN 'ADMIN_CLINICO'
    WHEN 'PHYSICIAN'        THEN 'DIR'
    WHEN 'ANEST'            THEN 'DIR'
    WHEN 'GO'               THEN 'DIR'
    WHEN 'PEDIA'            THEN 'DIR'
    WHEN 'LAB_TECHNICIAN'   THEN 'PHYSICIAN'
    WHEN 'RAD_TECHNICIAN'   THEN 'PHYSICIAN'
    WHEN 'FACTURACION'      THEN 'GERENTE'
    WHEN 'PHARMACIST'       THEN 'DIR'
    WHEN 'BODEGA'           THEN 'GERENTE'
    WHEN 'ADMISSION_CLERK'  THEN 'GERENTE'
    ELSE 'DIR'
  END;
$$;

-- ---------------------------------------------------------------------------
-- Cron: cada 15 minutos.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_job INT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'caretask_sla_watchdog';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
END $$;

SELECT cron.schedule(
  'caretask_sla_watchdog',
  '*/15 * * * *',
  $$
    -- 70% del SLA → task.sla_warning (rol asignado original).
    WITH due AS (
      SELECT id, "organizationId", "establishmentId", "serviceUnitId",
             "assignedRoleCode", "sourceType", "sourceId", "taskType", title,
             "dueAt", "createdAt"
      FROM public."CareTask"
      WHERE "slaMinutes" IS NOT NULL
        AND "dueAt" IS NOT NULL
        AND status NOT IN ('CUMPLIDA', 'CANCELADA')
        AND "slaWarningEmittedAt" IS NULL
        AND NOW() >= "createdAt" + ("dueAt" - "createdAt") * 0.7
      FOR UPDATE SKIP LOCKED
    ),
    marked AS (
      UPDATE public."CareTask" ct
      SET "slaWarningEmittedAt" = NOW()
      FROM due
      WHERE ct.id = due.id
      RETURNING due.*
    )
    INSERT INTO public."DomainEvent" (
      "organizationId", "eventType", "aggregateType", "aggregateId",
      "emittedById", payload, "occurredAt"
    )
    SELECT
      "organizationId",
      'task.sla_warning',
      'CareTask',
      id,
      NULL,
      jsonb_build_object(
        'taskType', "taskType",
        'sourceType', "sourceType",
        'sourceId', "sourceId",
        'assignedRoleCode', "assignedRoleCode",
        'establishmentId', "establishmentId",
        'serviceUnitId', "serviceUnitId",
        'dueAt', to_char("dueAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'url', '/tareas',
        'resumen', title
      ),
      NOW()
    FROM marked;

    -- 100% del SLA (vencida) → task.sla_exceeded (rol ESCALADO).
    WITH exceeded AS (
      SELECT id, "organizationId", "establishmentId", "serviceUnitId",
             "assignedRoleCode", "sourceType", "sourceId", "taskType", title,
             "dueAt"
      FROM public."CareTask"
      WHERE "slaMinutes" IS NOT NULL
        AND "dueAt" IS NOT NULL
        AND status NOT IN ('CUMPLIDA', 'CANCELADA')
        AND "slaExceededEmittedAt" IS NULL
        AND NOW() >= "dueAt"
      FOR UPDATE SKIP LOCKED
    ),
    marked2 AS (
      UPDATE public."CareTask" ct
      SET "slaExceededEmittedAt" = NOW()
      FROM exceeded
      WHERE ct.id = exceeded.id
      RETURNING exceeded.*
    )
    INSERT INTO public."DomainEvent" (
      "organizationId", "eventType", "aggregateType", "aggregateId",
      "emittedById", payload, "occurredAt"
    )
    SELECT
      "organizationId",
      'task.sla_exceeded',
      'CareTask',
      id,
      NULL,
      jsonb_build_object(
        'taskType', "taskType",
        'sourceType', "sourceType",
        'sourceId', "sourceId",
        'assignedRoleCode', public.fn_cc0031_escalation_role("assignedRoleCode"),
        'establishmentId', "establishmentId",
        'serviceUnitId', "serviceUnitId",
        'dueAt', to_char("dueAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'url', '/tareas',
        'resumen', title
      ),
      NOW()
    FROM marked2;
  $$
);
