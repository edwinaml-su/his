-- ============================================================================
-- 241_triage_sla_watchdog.sql
-- C8 (docs/audit/2026-09-15_cobertura/01-admision-emergencia-hosp-quirofano.md
-- §2 P0-7 / hallazgo B13) — watchdog de SLA de espera Manchester: hoy un
-- paciente clasificado ROJO/NARANJA (o cualquier color) cuyo tiempo objetivo
-- de espera venció sin que se le haya iniciado atención NO genera ninguna
-- alerta activa — la única "protección" es que alguien mire el wallboard.
--
-- ⚠️ PENDIENTE DE APLICAR — @Orq lo aplica a prod vía MCP (patrón del repo:
-- @Dev no ejecuta apply_migration). Requiere sql/238 y sql/238b ya aplicados
-- (roles TRIAGE_NURSE/ADMIN_CLINICO + dispatcher `task.sla_exceeded` ya
-- resuelven por `assignedRoleCode`, ver dispatcher.ts:159-176).
--
-- Patrón: espejo de sql/238b_cc0031_sla_watchdog.sql (idempotencia por
-- COLUMNA de guarda `slaExceededEmittedAt`, NO por ventana de tiempo como
-- sql/114/120 — evita duplicar alertas si el cron se atrasa) y de
-- sql/120_morse_sla_watchdog.sql (mismo dominio JCI: vigilancia de escala
-- clínica por cron sobre tablas `public.*`).
--
-- Modelo real investigado (evidencia, no NO VERIFICADO):
--   `public."TriageEvaluation"` (schema.prisma:2013) — evaluación Manchester
--   de un encuentro. `status='COMPLETED'` + `completedAt` se setean en el
--   MISMO instante en que se asigna el nivel/color
--   (triage.router.ts:setAssignedLevel líneas 252-260 y
--   createEvaluation líneas 181-196) — ESE es el inicio del reloj de espera
--   por atención médica, no `startedAt` (que es el inicio del PROCESO de
--   clasificación, ya cubierto por el TaskType `TRIAGE_IN_PROGRESS` /
--   SLA de 10 min fijo — semántica distinta, no se duplica acá).
--
--   `public."TriageLevel".maxWaitMinutes` (schema.prisma:1927-1949) ya trae
--   sembrados los umbrales exactos del encargo (seed.ts:468-472):
--   RED=0, ORANGE=10, YELLOW=60, GREEN=120, BLUE=240 — se leen de la tabla,
--   NO se hardcodean acá. Para RED (inmediato, 0 min) se aplica +5 min de
--   gracia operativa (el propio encargo lo pide: 0 min es inejecutable como
--   umbral de alerta sin producir ruido constante).
--
-- Criterio de "atendido" elegido (evidencia, ver §Supuestos abajo por lo que
-- se descartó): EXISTS una `public."EmergencyVisit"` para la evaluación
-- (`triageEvaluationId`) con `treatingId IS NOT NULL` (médico tratante ya
-- asignado) O `disposition <> 'PENDING'` (ya transicionó de estado). Es
-- EXACTAMENTE el mismo criterio que ya usa `detectLwbsCandidate` para "no
-- visto" en emergency.router.ts:333-337 (candidatos LWBS: `disposition:
-- "PENDING", treatingId: null`) — no se inventa un criterio nuevo, se
-- reutiliza el que el propio módulo de Emergencia ya trata como señal de
-- "el paciente sigue esperando, nadie lo ha tomado". Si no existe ninguna
-- `EmergencyVisit` vinculada todavía (el triage se completó pero el
-- paciente ni siquiera fue admitido a Urgencias), también cuenta como "no
-- atendido" — es el peor caso, no uno a excluir.
--
-- Matching por `EmergencyVisit.triageEvaluationId` O por `encounterId`
-- (cuando la evaluación tiene uno): `triageEvaluationId` se fija UNA sola
-- vez al crear la visita (emergency.router.ts:200) y nunca se actualiza —
-- si en el futuro se re-triagea al mismo paciente/encuentro (`reTriageOfId`,
-- hoy sin ningún mutation que lo escriba, pero modelado en schema.prisma)
-- la evaluación NUEVA no coincidiría con ese id aunque el paciente ya tenga
-- médico tratante asignado. El OR por `encounterId` cierra ese hueco sin
-- esperar a que exista el flujo de re-triage real (hallazgo de la revisión
-- pre-PR de este mismo cambio).
--
-- Descartado `TriageEvaluation.status` como criterio de "atendido": pasa a
-- COMPLETED en el momento de clasificar, no cuando un médico ve al paciente
-- — usarlo daría 0 alertas siempre (toda fila candidata ya es COMPLETED por
-- definición de la propia query).
-- Descartado un campo `attendedAt`: no existe en ningún modelo de triage o
-- emergencia (grep confirmado); agregarlo sería scope creep de un campo
-- nuevo con su propio flujo de escritura, fuera de "pieza corta" del
-- encargo.
--
-- Eventos emitidos (contrato `taskNotificationPayloadSchema`,
-- packages/contracts/src/events/payloads.ts:1262-1279 — payload libre, sin
-- FK a `taskTypeEnum`; el dispatcher resuelve por `assignedRoleCode`, no por
-- `taskType`, ver dispatcher.ts:159-176):
--   1. Siempre: `task.sla_exceeded` → `assignedRoleCode='TRIAGE_NURSE'`
--      (rol asignado original — TaskType `TRIAGE_REVIEW_SLA`,
--      packages/contracts/src/schemas/workflow-inbox.ts).
--   2. Solo si color ROJO/NARANJA: SEGUNDO evento `task.sla_exceeded` →
--      `assignedRoleCode='ADMIN_CLINICO'` — escalamiento inmediato en
--      niveles críticos (mismo rol de escalamiento que
--      `ESCALATION_ROLE_BY_ASSIGNED_ROLE.TRIAGE_NURSE` en
--      notification-roles.ts y `fn_cc0031_escalation_role('TRIAGE_NURSE')`
--      en sql/238b — consistente con el resto de CC-0031, no un rol nuevo).
-- ============================================================================

ALTER TABLE public."TriageEvaluation"
  ADD COLUMN IF NOT EXISTS "slaExceededEmittedAt" TIMESTAMPTZ;

-- Índice parcial: el cron solo escanea filas COMPLETED aún sin guarda —
-- mismo criterio que el WHERE de la query, evita full scan de la tabla.
CREATE INDEX IF NOT EXISTS idx_triage_evaluation_sla_pending
  ON public."TriageEvaluation" (status, "completedAt")
  WHERE "slaExceededEmittedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Cron: cada 5 minutos (encargo explícito — más frecuente que
-- caretask_sla_watchdog de sql/238b porque ROJO/NARANJA tienen SLA de
-- minutos, no de horas).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_job INT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'triage_sla_watchdog';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
END $$;

SELECT cron.schedule(
  'triage_sla_watchdog',
  '*/5 * * * *',
  $$
    WITH due AS (
      SELECT te.id, te."organizationId", te."establishmentId", te."serviceUnitId",
             te."completedAt", tl.color, tl.name AS "levelName", tl."maxWaitMinutes"
      FROM public."TriageEvaluation" te
      JOIN public."TriageLevel" tl ON tl.id = te."assignedLevelId"
      WHERE te.status = 'COMPLETED'
        AND te."completedAt" IS NOT NULL
        AND te."slaExceededEmittedAt" IS NULL
        AND NOW() >= te."completedAt"
          + (tl."maxWaitMinutes" + CASE WHEN tl.color = 'RED' THEN 5 ELSE 0 END) * INTERVAL '1 minute'
        AND NOT EXISTS (
          SELECT 1
          FROM public."EmergencyVisit" ev
          WHERE (
              ev."triageEvaluationId" = te.id
              OR (te."encounterId" IS NOT NULL AND ev."encounterId" = te."encounterId")
            )
            AND (ev."treatingId" IS NOT NULL OR ev.disposition <> 'PENDING')
        )
      FOR UPDATE OF te SKIP LOCKED
    ),
    marked AS (
      UPDATE public."TriageEvaluation" te
      SET "slaExceededEmittedAt" = NOW()
      FROM due
      WHERE te.id = due.id
      RETURNING due.*
    ),
    events AS (
      -- Evento primario: rol asignado original (TRIAGE_NURSE).
      SELECT id, "organizationId", "establishmentId", "serviceUnitId",
             "completedAt", color, "levelName", "maxWaitMinutes",
             'TRIAGE_NURSE'::text AS "assignedRoleCode"
      FROM marked
      UNION ALL
      -- Escalamiento inmediato ROJO/NARANJA: segundo evento al rol escalado.
      SELECT id, "organizationId", "establishmentId", "serviceUnitId",
             "completedAt", color, "levelName", "maxWaitMinutes",
             'ADMIN_CLINICO'::text AS "assignedRoleCode"
      FROM marked
      WHERE color IN ('RED', 'ORANGE')
    )
    INSERT INTO public."DomainEvent" (
      "organizationId", "eventType", "aggregateType", "aggregateId",
      "emittedById", payload, "occurredAt"
    )
    SELECT
      "organizationId",
      'task.sla_exceeded',
      'TriageEvaluation',
      id,
      NULL,
      jsonb_build_object(
        'taskType', 'TRIAGE_REVIEW_SLA',
        'sourceType', 'TRIAGE_EVALUATION',
        'sourceId', id,
        'assignedRoleCode', "assignedRoleCode",
        'establishmentId', "establishmentId",
        'serviceUnitId', "serviceUnitId",
        'dueAt', to_char(
          ("completedAt" + ("maxWaitMinutes" + CASE WHEN color = 'RED' THEN 5 ELSE 0 END) * INTERVAL '1 minute')
            AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'url', '/triage',
        'resumen', 'Triage ' || "levelName" || ' vencido — ' ||
          GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - "completedAt")) / 60.0)
            - ("maxWaitMinutes" + CASE WHEN color = 'RED' THEN 5 ELSE 0 END))::text
          || ' min sobre el objetivo'
      ),
      NOW()
    FROM events;
  $$
);
