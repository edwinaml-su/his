-- =====================================================================
-- 241_triage_sla_watchdog_smoke.sql
-- Smoke test transaccional de 241_triage_sla_watchdog.sql
-- (auditoría 2026-09-15, hallazgo C8/B13/P0-7).
--
-- Requiere que 241_triage_sla_watchdog.sql YA esté aplicado en la sesión/BD
-- contra la que se corre este archivo (columna "slaExceededEmittedAt" +
-- índice presentes; el cron `triage_sla_watchdog` en sí no se ejecuta acá —
-- este smoke corre el MISMO cuerpo de query manualmente, una sola vez por
-- aserción, para no depender de pg_cron). Corre 100% dentro de UNA
-- transacción que termina en ROLLBACK — no persiste ninguna fila.
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/241_triage_sla_watchdog.sql
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/241_triage_sla_watchdog_smoke.sql
--
-- No se demota a rol `authenticated`: ejercita la LÓGICA de negocio del
-- watchdog (idempotencia, escalamiento ROJO/NARANJA, exclusión por
-- "atendido"), no RLS — mismo patrón que 240_expiracion_reservas_reversion_smoke.sql.
--
-- Fixtures: reutiliza una organización EXISTENTE que ya tenga sembrado el
-- catálogo Manchester (TriageLevel RED+GREEN activos), un TriageFlowchart
-- activo y un Encounter — mismo patrón de "cualquier fila real" que
-- 240_..._smoke.sql. Inserta sus PROPIAS filas de TriageEvaluation /
-- EmergencyVisit (UUIDs fijos 000...0241NN) para controlar completedAt.
--
-- Qué verifica:
--   1. RED vencido (10 min tras completedAt, umbral 0+5min gracia) y SIN
--      EmergencyVisit vinculada → guarda seteada + 2 DomainEvent
--      task.sla_exceeded (TRIAGE_NURSE y ADMIN_CLINICO — escalamiento
--      inmediato en color crítico).
--   2. GREEN vencido (200 min tras completedAt, umbral 120) y SIN
--      EmergencyVisit → guarda seteada + SOLO 1 DomainEvent
--      (TRIAGE_NURSE, sin escalamiento — no es ROJO/NARANJA).
--   3. RED vencido pero CON EmergencyVisit "atendida" (treatingId seteado)
--      → guarda NUNCA seteada, CERO eventos (criterio de "atendido").
--   4. Idempotencia: correr el mismo query una segunda vez no duplica
--      eventos para las filas ya marcadas (la guarda las excluye).
--
-- Falla ruidosamente (RAISE EXCEPTION, aborta la transacción) ante
-- cualquier aserción incumplida — no hay asserts silenciosos.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

-- ---------------------------------------------------------------------
-- Fixtures base — org con catálogo Manchester + flowchart + encounter ya
-- sembrados (db:seed), reutilizados tal cual (patrón smoke 240).
-- ---------------------------------------------------------------------
INSERT INTO smoke_ids (key, value)
SELECT 'org', o.id
FROM "Organization" o
WHERE EXISTS (SELECT 1 FROM "TriageLevel" tl WHERE tl."organizationId" = o.id AND tl.color = 'RED' AND tl.active)
  AND EXISTS (SELECT 1 FROM "TriageLevel" tl WHERE tl."organizationId" = o.id AND tl.color = 'GREEN' AND tl.active)
  AND EXISTS (SELECT 1 FROM "TriageFlowchart" tf WHERE tf."organizationId" = o.id AND tf.active)
  AND EXISTS (SELECT 1 FROM "Encounter" e WHERE e."organizationId" = o.id)
LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key = 'org') = 0 THEN
    RAISE EXCEPTION
      'Smoke 241 requiere >=1 Organization con TriageLevel RED+GREEN activos, '
      'TriageFlowchart activo y >=1 Encounter — no encontrada. Corre npm run db:seed primero.';
  END IF;
END $$;

INSERT INTO smoke_ids (key, value)
SELECT 'red_level', id FROM "TriageLevel"
 WHERE "organizationId" = (SELECT value FROM smoke_ids WHERE key = 'org') AND color = 'RED' AND active
 LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'green_level', id FROM "TriageLevel"
 WHERE "organizationId" = (SELECT value FROM smoke_ids WHERE key = 'org') AND color = 'GREEN' AND active
 LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'flowchart', id FROM "TriageFlowchart"
 WHERE "organizationId" = (SELECT value FROM smoke_ids WHERE key = 'org') AND active
 LIMIT 1;

-- Excluye encounters que YA tienen EmergencyVisit (encounterId es UNIQUE en
-- EmergencyVisit) — el fixture 3 inserta su propia EmergencyVisit sobre este
-- encounter, así que debe estar libre.
INSERT INTO smoke_ids (key, value)
SELECT 'encounter', e.id FROM "Encounter" e
 WHERE e."organizationId" = (SELECT value FROM smoke_ids WHERE key = 'org')
   AND NOT EXISTS (SELECT 1 FROM "EmergencyVisit" ev WHERE ev."encounterId" = e.id)
 ORDER BY e."createdAt" DESC
 LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'estab', "establishmentId" FROM "Encounter"
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'encounter');

INSERT INTO smoke_ids (key, value)
SELECT 'patient', "patientId" FROM "Encounter"
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'encounter');

INSERT INTO smoke_ids (key, value)
SELECT 'country', "countryId" FROM "Organization"
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'org');

INSERT INTO smoke_ids (key, value)
SELECT 'user_id', id FROM "User" ORDER BY "createdAt" LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids) < 8 THEN
    RAISE EXCEPTION 'Smoke 241 — faltan fixtures base (esperaba 8 filas en smoke_ids, encontró %).',
      (SELECT count(*) FROM smoke_ids);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Fixture 1: ROJO vencido, sin EmergencyVisit → debe disparar 2 eventos.
-- completedAt hace 10 min; umbral RED = 0 + 5min gracia = 5 min.
-- ---------------------------------------------------------------------
INSERT INTO "TriageEvaluation" (
  id, "countryId", "organizationId", "establishmentId", "patientId",
  "flowchartId", "assignedLevelId", status, "startedAt", "completedAt", "updatedAt"
)
SELECT '00000000-0000-0000-0000-000000024101', country, org, estab, patient,
       flowchart, red_level, 'COMPLETED', now() - interval '11 minutes', now() - interval '10 minutes', now()
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key = 'country')     AS country,
          (SELECT value FROM smoke_ids WHERE key = 'org')         AS org,
          (SELECT value FROM smoke_ids WHERE key = 'estab')       AS estab,
          (SELECT value FROM smoke_ids WHERE key = 'patient')     AS patient,
          (SELECT value FROM smoke_ids WHERE key = 'flowchart')   AS flowchart,
          (SELECT value FROM smoke_ids WHERE key = 'red_level')   AS red_level
       ) f;

-- ---------------------------------------------------------------------
-- Fixture 2: VERDE vencido, sin EmergencyVisit → debe disparar 1 evento
-- (sin escalamiento). completedAt hace 200 min; umbral GREEN = 120 min.
-- ---------------------------------------------------------------------
INSERT INTO "TriageEvaluation" (
  id, "countryId", "organizationId", "establishmentId", "patientId",
  "flowchartId", "assignedLevelId", status, "startedAt", "completedAt", "updatedAt"
)
SELECT '00000000-0000-0000-0000-000000024102', country, org, estab, patient,
       flowchart, green_level, 'COMPLETED', now() - interval '201 minutes', now() - interval '200 minutes', now()
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key = 'country')     AS country,
          (SELECT value FROM smoke_ids WHERE key = 'org')         AS org,
          (SELECT value FROM smoke_ids WHERE key = 'estab')       AS estab,
          (SELECT value FROM smoke_ids WHERE key = 'patient')     AS patient,
          (SELECT value FROM smoke_ids WHERE key = 'flowchart')   AS flowchart,
          (SELECT value FROM smoke_ids WHERE key = 'green_level') AS green_level
       ) f;

-- ---------------------------------------------------------------------
-- Fixture 3: ROJO vencido pero CON EmergencyVisit ya "atendida"
-- (treatingId seteado) → NO debe disparar ningún evento.
-- ---------------------------------------------------------------------
INSERT INTO "TriageEvaluation" (
  id, "countryId", "organizationId", "establishmentId", "patientId",
  "flowchartId", "assignedLevelId", status, "startedAt", "completedAt", "updatedAt"
)
SELECT '00000000-0000-0000-0000-000000024103', country, org, estab, patient,
       flowchart, red_level, 'COMPLETED', now() - interval '31 minutes', now() - interval '30 minutes', now()
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key = 'country')     AS country,
          (SELECT value FROM smoke_ids WHERE key = 'org')         AS org,
          (SELECT value FROM smoke_ids WHERE key = 'estab')       AS estab,
          (SELECT value FROM smoke_ids WHERE key = 'patient')     AS patient,
          (SELECT value FROM smoke_ids WHERE key = 'flowchart')   AS flowchart,
          (SELECT value FROM smoke_ids WHERE key = 'red_level')   AS red_level
       ) f;

INSERT INTO "EmergencyVisit" (
  id, "organizationId", "establishmentId", "encounterId", "patientId",
  "treatingId", "chiefComplaint", "triageEvaluationId", "createdBy", "updatedAt"
)
SELECT '00000000-0000-0000-0000-000000024104', org, estab, encounter, patient,
       usr, 'Smoke 241 — fixture: ya tiene médico tratante asignado',
       '00000000-0000-0000-0000-000000024103', usr, now()
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key = 'org')       AS org,
          (SELECT value FROM smoke_ids WHERE key = 'estab')     AS estab,
          (SELECT value FROM smoke_ids WHERE key = 'encounter') AS encounter,
          (SELECT value FROM smoke_ids WHERE key = 'patient')   AS patient,
          (SELECT value FROM smoke_ids WHERE key = 'user_id')   AS usr
       ) f;

-- ---------------------------------------------------------------------
-- Ejecutar el cuerpo del watchdog (idéntico al de sql/241, primera corrida).
-- ---------------------------------------------------------------------
WITH due AS (
  SELECT te.id, te."organizationId", te."establishmentId", te."serviceUnitId",
         te."completedAt", tl.color, tl.name AS "levelName", tl."maxWaitMinutes"
  FROM "TriageEvaluation" te
  JOIN "TriageLevel" tl ON tl.id = te."assignedLevelId"
  WHERE te.status = 'COMPLETED'
    AND te."completedAt" IS NOT NULL
    AND te."slaExceededEmittedAt" IS NULL
    AND NOW() >= te."completedAt"
      + (tl."maxWaitMinutes" + CASE WHEN tl.color = 'RED' THEN 5 ELSE 0 END) * INTERVAL '1 minute'
    AND NOT EXISTS (
      SELECT 1
      FROM "EmergencyVisit" ev
      WHERE (
          ev."triageEvaluationId" = te.id
          OR (te."encounterId" IS NOT NULL AND ev."encounterId" = te."encounterId")
        )
        AND (ev."treatingId" IS NOT NULL OR ev.disposition <> 'PENDING')
    )
    -- Solo las 3 filas de este smoke test — el cron real no lleva este filtro.
    AND te.id IN (
      '00000000-0000-0000-0000-000000024101',
      '00000000-0000-0000-0000-000000024102',
      '00000000-0000-0000-0000-000000024103'
    )
),
marked AS (
  UPDATE "TriageEvaluation" te
  SET "slaExceededEmittedAt" = NOW()
  FROM due
  WHERE te.id = due.id
  RETURNING due.*
),
events AS (
  SELECT id, "organizationId", "establishmentId", "serviceUnitId",
         "completedAt", color, "levelName", "maxWaitMinutes",
         'TRIAGE_NURSE'::text AS "assignedRoleCode"
  FROM marked
  UNION ALL
  SELECT id, "organizationId", "establishmentId", "serviceUnitId",
         "completedAt", color, "levelName", "maxWaitMinutes",
         'ADMIN_CLINICO'::text AS "assignedRoleCode"
  FROM marked
  WHERE color IN ('RED', 'ORANGE')
)
INSERT INTO "DomainEvent" (
  "organizationId", "eventType", "aggregateType", "aggregateId",
  "emittedById", payload, "occurredAt"
)
SELECT
  "organizationId", 'task.sla_exceeded', 'TriageEvaluation', id, NULL,
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
    'resumen', 'Triage ' || "levelName" || ' vencido — smoke 241'
  ),
  NOW()
FROM events;

-- ---------------------------------------------------------------------
-- Aserciones — primera corrida.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_red_guard      timestamptz;
  v_green_guard    timestamptz;
  v_attended_guard timestamptz;
  v_red_events     int;
  v_green_events   int;
  v_attended_events int;
BEGIN
  SELECT "slaExceededEmittedAt" INTO v_red_guard
    FROM "TriageEvaluation" WHERE id = '00000000-0000-0000-0000-000000024101';
  IF v_red_guard IS NULL THEN
    RAISE EXCEPTION 'FAIL 1) ROJO vencido: esperaba slaExceededEmittedAt seteado, fue NULL.';
  END IF;
  RAISE NOTICE 'OK 1) ROJO vencido: guarda seteada.';

  SELECT count(*) INTO v_red_events
    FROM "DomainEvent"
   WHERE "aggregateId" = '00000000-0000-0000-0000-000000024101'
     AND "eventType" = 'task.sla_exceeded';
  IF v_red_events <> 2 THEN
    RAISE EXCEPTION 'FAIL 2) ROJO vencido: esperaba 2 DomainEvent (TRIAGE_NURSE + ADMIN_CLINICO), encontrados %.', v_red_events;
  END IF;
  IF (SELECT count(*) FROM "DomainEvent"
       WHERE "aggregateId" = '00000000-0000-0000-0000-000000024101'
         AND payload->>'assignedRoleCode' = 'ADMIN_CLINICO') <> 1 THEN
    RAISE EXCEPTION 'FAIL 2b) ROJO vencido: no se encontró el evento de escalamiento a ADMIN_CLINICO.';
  END IF;
  RAISE NOTICE 'OK 2) ROJO vencido: 2 eventos (TRIAGE_NURSE + escalamiento ADMIN_CLINICO).';

  SELECT "slaExceededEmittedAt" INTO v_green_guard
    FROM "TriageEvaluation" WHERE id = '00000000-0000-0000-0000-000000024102';
  IF v_green_guard IS NULL THEN
    RAISE EXCEPTION 'FAIL 3) VERDE vencido: esperaba slaExceededEmittedAt seteado, fue NULL.';
  END IF;

  SELECT count(*) INTO v_green_events
    FROM "DomainEvent"
   WHERE "aggregateId" = '00000000-0000-0000-0000-000000024102'
     AND "eventType" = 'task.sla_exceeded';
  IF v_green_events <> 1 THEN
    RAISE EXCEPTION 'FAIL 4) VERDE vencido: esperaba 1 DomainEvent (sin escalamiento), encontrados %.', v_green_events;
  END IF;
  IF (SELECT payload->>'assignedRoleCode' FROM "DomainEvent"
       WHERE "aggregateId" = '00000000-0000-0000-0000-000000024102' AND "eventType" = 'task.sla_exceeded') <> 'TRIAGE_NURSE' THEN
    RAISE EXCEPTION 'FAIL 4b) VERDE vencido: el único evento debía ir a TRIAGE_NURSE.';
  END IF;
  RAISE NOTICE 'OK 3-4) VERDE vencido: guarda seteada, 1 solo evento (sin escalamiento).';

  SELECT "slaExceededEmittedAt" INTO v_attended_guard
    FROM "TriageEvaluation" WHERE id = '00000000-0000-0000-0000-000000024103';
  IF v_attended_guard IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 5) ROJO atendido: esperaba slaExceededEmittedAt NULL (excluido por EmergencyVisit.treatingId), fue %.', v_attended_guard;
  END IF;

  SELECT count(*) INTO v_attended_events
    FROM "DomainEvent" WHERE "aggregateId" = '00000000-0000-0000-0000-000000024103';
  IF v_attended_events <> 0 THEN
    RAISE EXCEPTION 'FAIL 6) ROJO atendido: esperaba 0 DomainEvent, encontrados %.', v_attended_events;
  END IF;
  RAISE NOTICE 'OK 5-6) ROJO ya atendido (treatingId seteado): excluido, cero eventos.';
END $$;

-- ---------------------------------------------------------------------
-- Segunda corrida (idempotencia) — mismo cuerpo, ahora las 2 filas ya
-- vencidas tienen la guarda seteada: NOT NULL las excluye del WHERE.
-- ---------------------------------------------------------------------
WITH due AS (
  SELECT te.id, te."organizationId", te."establishmentId", te."serviceUnitId",
         te."completedAt", tl.color, tl.name AS "levelName", tl."maxWaitMinutes"
  FROM "TriageEvaluation" te
  JOIN "TriageLevel" tl ON tl.id = te."assignedLevelId"
  WHERE te.status = 'COMPLETED'
    AND te."completedAt" IS NOT NULL
    AND te."slaExceededEmittedAt" IS NULL
    AND NOW() >= te."completedAt"
      + (tl."maxWaitMinutes" + CASE WHEN tl.color = 'RED' THEN 5 ELSE 0 END) * INTERVAL '1 minute'
    AND NOT EXISTS (
      SELECT 1
      FROM "EmergencyVisit" ev
      WHERE (
          ev."triageEvaluationId" = te.id
          OR (te."encounterId" IS NOT NULL AND ev."encounterId" = te."encounterId")
        )
        AND (ev."treatingId" IS NOT NULL OR ev.disposition <> 'PENDING')
    )
    AND te.id IN (
      '00000000-0000-0000-0000-000000024101',
      '00000000-0000-0000-0000-000000024102',
      '00000000-0000-0000-0000-000000024103'
    )
),
marked AS (
  UPDATE "TriageEvaluation" te
  SET "slaExceededEmittedAt" = NOW()
  FROM due
  WHERE te.id = due.id
  RETURNING due.*
),
events AS (
  SELECT id, "organizationId", "establishmentId", "serviceUnitId",
         "completedAt", color, "levelName", "maxWaitMinutes",
         'TRIAGE_NURSE'::text AS "assignedRoleCode"
  FROM marked
  UNION ALL
  SELECT id, "organizationId", "establishmentId", "serviceUnitId",
         "completedAt", color, "levelName", "maxWaitMinutes",
         'ADMIN_CLINICO'::text AS "assignedRoleCode"
  FROM marked
  WHERE color IN ('RED', 'ORANGE')
)
INSERT INTO "DomainEvent" (
  "organizationId", "eventType", "aggregateType", "aggregateId",
  "emittedById", payload, "occurredAt"
)
SELECT
  "organizationId", 'task.sla_exceeded', 'TriageEvaluation', id, NULL,
  jsonb_build_object(
    'taskType', 'TRIAGE_REVIEW_SLA', 'sourceType', 'TRIAGE_EVALUATION', 'sourceId', id,
    'assignedRoleCode', "assignedRoleCode", 'establishmentId', "establishmentId",
    'serviceUnitId', "serviceUnitId",
    'dueAt', to_char(
      ("completedAt" + ("maxWaitMinutes" + CASE WHEN color = 'RED' THEN 5 ELSE 0 END) * INTERVAL '1 minute')
        AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'url', '/triage', 'resumen', 'Triage ' || "levelName" || ' vencido — smoke 241 (2da corrida)'
  ),
  NOW()
FROM events;

DO $$
DECLARE
  v_red_events_total   int;
  v_green_events_total int;
BEGIN
  SELECT count(*) INTO v_red_events_total
    FROM "DomainEvent" WHERE "aggregateId" = '00000000-0000-0000-0000-000000024101';
  IF v_red_events_total <> 2 THEN
    RAISE EXCEPTION 'FAIL 7) idempotencia ROJO: esperaba seguir en 2 DomainEvent tras 2da corrida, encontrados %.', v_red_events_total;
  END IF;

  SELECT count(*) INTO v_green_events_total
    FROM "DomainEvent" WHERE "aggregateId" = '00000000-0000-0000-0000-000000024102';
  IF v_green_events_total <> 1 THEN
    RAISE EXCEPTION 'FAIL 8) idempotencia VERDE: esperaba seguir en 1 DomainEvent tras 2da corrida, encontrados %.', v_green_events_total;
  END IF;

  RAISE NOTICE 'OK 7-8) idempotencia: la 2da corrida no duplicó eventos (guarda por columna, no por ventana de tiempo).';
  RAISE NOTICE 'SMOKE 241: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures y eventos quedan descartados
-- junto con la transacción.
ROLLBACK;
