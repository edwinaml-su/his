-- =====================================================================
-- 243_cc0036_turnos_smoke.sql
-- Smoke test transaccional de 243_cc0036_turnos.sql (CC-0036 Ola 1A —
-- rostering 24/7, REQ-HIS-AFIL-001 §5.1 Bloque C).
--
-- Requiere que 243_cc0036_turnos.sql YA esté aplicado en la sesión/BD
-- (btree_gist instalado, tablas PlantillaTurno/ProgramacionTurno/
-- AsignacionTurno + fn_medico_de_turno presentes). Corre 100% dentro de UNA
-- transacción que termina en ROLLBACK — no persiste ninguna fila. No demota
-- a rol `authenticated` — ejercita la LÓGICA de negocio (EXCLUDE de
-- traslape, columna generada cruzaMedianoche, resolución de sustitución),
-- no RLS. Mismo patrón que 241_triage_sla_watchdog_smoke.sql.
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/243_cc0036_turnos.sql
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/243_cc0036_turnos_smoke.sql
--
-- Qué verifica:
--   1. PlantillaTurno 07:00-19:00 -> cruzaMedianoche=false (columna generada).
--   2. PlantillaTurno 19:00-07:00 -> cruzaMedianoche=true (columna generada).
--   3. AsignacionTurno vigente para user1 -> fn_medico_de_turno la resuelve.
--   4. Un segundo AsignacionTurno del MISMO user1 con rango solapado y
--      estado vigente -> rechazado por excl_asignacion_turno_traslape.
--   5. Sustitución (estado='SUSTITUIDO', sustitutoUserId=user2) ->
--      fn_medico_de_turno devuelve a user2, no a user1.
--   6. ProgramacionTurno en BORRADOR (no PUBLICADA) -> fn_medico_de_turno NO
--      resuelve ninguna fila aunque exista una AsignacionTurno vigente.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

-- ---------------------------------------------------------------------
-- Fixtures base — cualquier Organization con Establishment sembrado +
-- 2 Users distintos (mismo patrón de "cualquier fila real" que 241).
-- ---------------------------------------------------------------------
INSERT INTO smoke_ids (key, value)
SELECT 'org', o.id
FROM "Organization" o
WHERE EXISTS (SELECT 1 FROM "Establishment" e WHERE e."organizationId" = o.id)
LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key = 'org') = 0 THEN
    RAISE EXCEPTION 'Smoke 243 requiere >=1 Organization con Establishment — no encontrada. Corre npm run db:seed primero.';
  END IF;
END $$;

INSERT INTO smoke_ids (key, value)
SELECT 'estab', id FROM "Establishment"
 WHERE "organizationId" = (SELECT value FROM smoke_ids WHERE key = 'org')
 LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'user1', id FROM "User" WHERE active = true ORDER BY "createdAt" LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'user2', id FROM "User"
 WHERE active = true AND id <> (SELECT value FROM smoke_ids WHERE key = 'user1')
 ORDER BY "createdAt" LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids) < 4 THEN
    RAISE EXCEPTION 'Smoke 243 — requiere >=2 User activos distintos (encontró %).', (SELECT count(*) FROM smoke_ids);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Fixture: 2 PlantillaTurno (diurna normal + nocturna cruza medianoche).
-- ---------------------------------------------------------------------
INSERT INTO "PlantillaTurno" (id, "organizationId", "establishmentId", codigo, nombre, "horaInicio", "horaFin", tipo, "dotacionRequerida")
SELECT '00000000-0000-0000-0000-000000024301', org, estab, 'SMK-DIA', 'Smoke 243 — Turno diurno', '07:00', '19:00', 'MEDICO_GENERAL', 1
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='estab') estab) f;

INSERT INTO "PlantillaTurno" (id, "organizationId", "establishmentId", codigo, nombre, "horaInicio", "horaFin", tipo, "dotacionRequerida")
SELECT '00000000-0000-0000-0000-000000024302', org, estab, 'SMK-NOC', 'Smoke 243 — Turno nocturno', '19:00', '07:00', 'MEDICO_GENERAL', 1
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='estab') estab) f;

DO $$
DECLARE
  v_dia_cruza boolean;
  v_noc_cruza boolean;
BEGIN
  SELECT "cruzaMedianoche" INTO v_dia_cruza FROM "PlantillaTurno" WHERE id = '00000000-0000-0000-0000-000000024301';
  IF v_dia_cruza IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL 1) turno diurno 07:00-19:00: esperaba cruzaMedianoche=false, fue %.', v_dia_cruza;
  END IF;
  RAISE NOTICE 'OK 1) turno diurno: cruzaMedianoche=false (columna generada).';

  SELECT "cruzaMedianoche" INTO v_noc_cruza FROM "PlantillaTurno" WHERE id = '00000000-0000-0000-0000-000000024302';
  IF v_noc_cruza IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 2) turno nocturno 19:00-07:00: esperaba cruzaMedianoche=true, fue %.', v_noc_cruza;
  END IF;
  RAISE NOTICE 'OK 2) turno nocturno: cruzaMedianoche=true (columna generada).';
END $$;

-- ---------------------------------------------------------------------
-- Fixture: ProgramacionTurno PUBLICADA cubriendo "hoy".
-- ---------------------------------------------------------------------
INSERT INTO "ProgramacionTurno" (id, "organizationId", "establishmentId", "periodoDesde", "periodoHasta", estado, "publicadaAt")
SELECT '00000000-0000-0000-0000-000000024310', org, estab, date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date, 'PUBLICADA', now()
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='estab') estab) f;

-- Segunda programación, en BORRADOR, para el caso 6.
INSERT INTO "ProgramacionTurno" (id, "organizationId", "establishmentId", "periodoDesde", "periodoHasta", estado)
SELECT '00000000-0000-0000-0000-000000024311', org, estab, (date_trunc('month', now()) + interval '1 month')::date, (date_trunc('month', now()) + interval '2 month - 1 day')::date, 'BORRADOR'
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='estab') estab) f;

-- ---------------------------------------------------------------------
-- Fixture: AsignacionTurno vigente de user1, turno diurno de HOY,
-- rango [hoy 07:00, hoy 19:00) en UTC absoluto simplificado con `now()`
-- truncado a hoy 12:00 como instante de referencia de las aserciones.
-- ---------------------------------------------------------------------
INSERT INTO "AsignacionTurno" (
  id, "organizationId", "establishmentId", "programacionId", "plantillaTurnoId",
  "userId", fecha, "inicioProgramado", "finProgramado", estado
)
SELECT
  '00000000-0000-0000-0000-000000024320', org, estab,
  '00000000-0000-0000-0000-000000024310', '00000000-0000-0000-0000-000000024301',
  u1, current_date, date_trunc('day', now()) + interval '7 hours', date_trunc('day', now()) + interval '19 hours',
  'PROGRAMADO'
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key='org')   org,
          (SELECT value FROM smoke_ids WHERE key='estab') estab,
          (SELECT value FROM smoke_ids WHERE key='user1') u1
       ) f;

-- ---------------------------------------------------------------------
-- Aserción 3: fn_medico_de_turno resuelve a user1 al mediodía de hoy.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_resuelto uuid;
  v_esperado uuid;
BEGIN
  SELECT value INTO v_esperado FROM smoke_ids WHERE key = 'user1';
  SELECT "userId" INTO v_resuelto
    FROM public.fn_medico_de_turno(
      (SELECT value FROM smoke_ids WHERE key = 'estab'),
      date_trunc('day', now()) + interval '12 hours'
    );
  IF v_resuelto IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'FAIL 3) fn_medico_de_turno: esperaba user1 (%), obtuvo %.', v_esperado, v_resuelto;
  END IF;
  RAISE NOTICE 'OK 3) fn_medico_de_turno resuelve al médico de turno vigente (user1).';
END $$;

-- ---------------------------------------------------------------------
-- Aserción 4: un segundo AsignacionTurno del MISMO user1 con rango
-- solapado (10:00-20:00, turno nocturno) y estado vigente -> rechazado
-- por excl_asignacion_turno_traslape. Capturado con EXCEPTION (PL/pgSQL
-- crea un savepoint implícito) para no abortar el resto del smoke.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_org   uuid := (SELECT value FROM smoke_ids WHERE key = 'org');
  v_estab uuid := (SELECT value FROM smoke_ids WHERE key = 'estab');
  v_u1    uuid := (SELECT value FROM smoke_ids WHERE key = 'user1');
  v_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO "AsignacionTurno" (
      id, "organizationId", "establishmentId", "programacionId", "plantillaTurnoId",
      "userId", fecha, "inicioProgramado", "finProgramado", estado
    ) VALUES (
      '00000000-0000-0000-0000-000000024321', v_org, v_estab,
      '00000000-0000-0000-0000-000000024310', '00000000-0000-0000-0000-000000024302',
      v_u1, current_date,
      date_trunc('day', now()) + interval '10 hours',
      date_trunc('day', now()) + interval '20 hours',
      'CONFIRMADO'
    );
  EXCEPTION WHEN exclusion_violation THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL 4) esperaba exclusion_violation por traslape del mismo usuario, la segunda asignación se insertó.';
  END IF;
  RAISE NOTICE 'OK 4) excl_asignacion_turno_traslape rechaza el traslape del mismo usuario.';
END $$;

-- ---------------------------------------------------------------------
-- Aserción 5: sustitución — user1 -> SUSTITUIDO, sustitutoUserId=user2.
-- fn_medico_de_turno debe devolver a user2 al mismo instante.
-- ---------------------------------------------------------------------
UPDATE "AsignacionTurno"
   SET estado = 'SUSTITUIDO', "sustitutoUserId" = (SELECT value FROM smoke_ids WHERE key = 'user2'),
       "motivoCambio" = 'Smoke 243 — sustitución de prueba'
 WHERE id = '00000000-0000-0000-0000-000000024320';

DO $$
DECLARE
  v_resuelto uuid;
  v_esperado uuid;
BEGIN
  SELECT value INTO v_esperado FROM smoke_ids WHERE key = 'user2';
  SELECT "userId" INTO v_resuelto
    FROM public.fn_medico_de_turno(
      (SELECT value FROM smoke_ids WHERE key = 'estab'),
      date_trunc('day', now()) + interval '12 hours'
    );
  IF v_resuelto IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'FAIL 5) tras sustitución: esperaba user2 (%), obtuvo %.', v_esperado, v_resuelto;
  END IF;
  RAISE NOTICE 'OK 5) fn_medico_de_turno resuelve al sustituto (user2) tras SUSTITUIDO.';
END $$;

-- ---------------------------------------------------------------------
-- Aserción 6: una AsignacionTurno vigente sobre una ProgramacionTurno en
-- BORRADOR (no PUBLICADA) NO debe resolverse.
-- ---------------------------------------------------------------------
INSERT INTO "AsignacionTurno" (
  id, "organizationId", "establishmentId", "programacionId", "plantillaTurnoId",
  "userId", fecha, "inicioProgramado", "finProgramado", estado
)
SELECT
  '00000000-0000-0000-0000-000000024322', org, estab,
  '00000000-0000-0000-0000-000000024311', '00000000-0000-0000-0000-000000024301',
  u2, (current_date + interval '1 month')::date,
  date_trunc('day', now()) + interval '1 month' + interval '7 hours',
  date_trunc('day', now()) + interval '1 month' + interval '19 hours',
  'PROGRAMADO'
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key='org')   org,
          (SELECT value FROM smoke_ids WHERE key='estab') estab,
          (SELECT value FROM smoke_ids WHERE key='user2') u2
       ) f;

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.fn_medico_de_turno(
      (SELECT value FROM smoke_ids WHERE key = 'estab'),
      date_trunc('day', now()) + interval '1 month' + interval '12 hours'
    );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 6) ProgramacionTurno en BORRADOR: esperaba 0 filas resueltas, obtuvo %.', v_count;
  END IF;
  RAISE NOTICE 'OK 6) ProgramacionTurno en BORRADOR: fn_medico_de_turno no resuelve ninguna fila.';
  RAISE NOTICE 'SMOKE 243: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures quedan descartados junto con la
-- transacción.
ROLLBACK;
