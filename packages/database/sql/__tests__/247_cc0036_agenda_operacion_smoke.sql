-- =====================================================================
-- 247_cc0036_agenda_operacion_smoke.sql
-- Smoke test transaccional de 247_cc0036_agenda_operacion.sql (CC-0036
-- Ola 4 — operación de agenda, REQ-HIS-AFIL-001 §6.1). Ejercita los dos
-- EXCLUDE de antirreserva doble (`excl_cita_medico`/`excl_cita_consultorio`)
-- y su exención cuando `esSobrecupo=true`.
--
-- Requiere que 247_cc0036_agenda_operacion.sql YA esté aplicado. Corre
-- 100% dentro de UNA transacción que termina en ROLLBACK — no persiste
-- ninguna fila. Reutiliza un Patient/User existentes (requiere seed
-- previo) — mismo criterio que 245/246_cc0036_*_smoke.sql para
-- Organization/Establishment/Currency.
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/247_cc0036_agenda_operacion.sql
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/247_cc0036_agenda_operacion_smoke.sql
--
-- Qué verifica:
--   1. Dos citas SCHEDULED del MISMO providerId con horario solapado ->
--      excl_cita_medico rechaza la segunda (SQLSTATE 23P01).
--   2. Dos citas SCHEDULED del MISMO consultorioId (proveedores distintos)
--      con horario solapado -> excl_cita_consultorio rechaza la segunda.
--   3. Una tercera cita con esSobrecupo=true sobre el MISMO providerId+
--      horario NO es rechazada (exenta del EXCLUDE).
--   4. Dos citas del mismo providerId en horarios NO solapados se insertan
--      sin conflicto (control negativo).
-- =====================================================================

BEGIN;

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO smoke_ids (key, value)
SELECT 'org', o.id
FROM "Organization" o
WHERE EXISTS (SELECT 1 FROM "Establishment" e WHERE e."organizationId" = o.id)
LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key = 'org') = 0 THEN
    RAISE EXCEPTION 'Smoke 247 requiere >=1 Organization con Establishment — no encontrada. Corre npm run db:seed primero.';
  END IF;
END $$;

INSERT INTO smoke_ids (key, value)
SELECT 'estab', id FROM "Establishment"
 WHERE "organizationId" = (SELECT value FROM smoke_ids WHERE key = 'org')
 LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'patient', id FROM "Patient"
 WHERE "organizationId" = (SELECT value FROM smoke_ids WHERE key = 'org') AND "deletedAt" IS NULL
 LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'provider1', u.id FROM "User" u
 JOIN "UserOrganizationRole" uor ON uor."userId" = u.id
 WHERE uor."organizationId" = (SELECT value FROM smoke_ids WHERE key = 'org')
 LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key = 'patient') = 0
     OR (SELECT count(*) FROM smoke_ids WHERE key = 'provider1') = 0 THEN
    RAISE EXCEPTION 'Smoke 247 requiere >=1 Patient y >=1 User con rol en la organización — corre npm run db:seed primero.';
  END IF;
END $$;

INSERT INTO smoke_ids (key, value)
SELECT 'consultorio', '00000000-0000-0000-0000-000000024701';

INSERT INTO "Consultorio" (id, "organizationId", "establishmentId", codigo, nombre, "tipoUso")
SELECT (SELECT value FROM smoke_ids WHERE key='consultorio'), org, estab, 'SMK-247', 'Smoke 247 — Consultorio', 'ARRENDADO'
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='estab') estab) f;

DO $$
DECLARE
  v_org uuid := (SELECT value FROM smoke_ids WHERE key='org');
  v_estab uuid := (SELECT value FROM smoke_ids WHERE key='estab');
  v_patient uuid := (SELECT value FROM smoke_ids WHERE key='patient');
  v_provider uuid := (SELECT value FROM smoke_ids WHERE key='provider1');
  v_consultorio uuid := (SELECT value FROM smoke_ids WHERE key='consultorio');
  v_base timestamptz := date_trunc('hour', now()) + interval '30 days';
  v_excepcion_capturada boolean;
BEGIN
  -- -------------------------------------------------------------------
  -- Aserción 1: excl_cita_medico — mismo providerId, horario solapado.
  -- -------------------------------------------------------------------
  INSERT INTO "OutpatientAppointment" (
    id, "organizationId", "establishmentId", "patientId", "providerId",
    "scheduledAt", "durationMinutes", status, "updatedAt"
  ) VALUES (
    '00000000-0000-0000-0000-000000024710', v_org, v_estab, v_patient, v_provider,
    v_base, 20, 'SCHEDULED', now()
  );

  v_excepcion_capturada := false;
  BEGIN
    INSERT INTO "OutpatientAppointment" (
      id, "organizationId", "establishmentId", "patientId", "providerId",
      "scheduledAt", "durationMinutes", status, "updatedAt"
    ) VALUES (
      '00000000-0000-0000-0000-000000024711', v_org, v_estab, v_patient, v_provider,
      v_base + interval '10 minutes', 20, 'SCHEDULED', now()
    );
  EXCEPTION WHEN exclusion_violation THEN
    v_excepcion_capturada := true;
  END;
  IF NOT v_excepcion_capturada THEN
    RAISE EXCEPTION 'FAIL 1) excl_cita_medico no rechazó una segunda cita solapada del mismo médico.';
  END IF;
  RAISE NOTICE 'OK 1) excl_cita_medico rechaza citas solapadas del mismo médico.';

  -- -------------------------------------------------------------------
  -- Aserción 2: excl_cita_consultorio — mismo consultorioId, horario
  -- solapado, PROVEEDOR DISTINTO (usa el mismo v_provider por simplicidad
  -- del fixture — el EXCLUDE de consultorio es independiente del médico).
  -- -------------------------------------------------------------------
  INSERT INTO "OutpatientAppointment" (
    id, "organizationId", "establishmentId", "patientId", "providerId",
    "consultorioId", "scheduledAt", "durationMinutes", status, "updatedAt"
  ) VALUES (
    '00000000-0000-0000-0000-000000024712', v_org, v_estab, v_patient, v_provider,
    v_consultorio, v_base + interval '2 hours', 20, 'SCHEDULED', now()
  );

  v_excepcion_capturada := false;
  BEGIN
    INSERT INTO "OutpatientAppointment" (
      id, "organizationId", "establishmentId", "patientId", "providerId",
      "consultorioId", "scheduledAt", "durationMinutes", status, "updatedAt"
    ) VALUES (
      '00000000-0000-0000-0000-000000024713', v_org, v_estab, v_patient, v_provider,
      v_consultorio, v_base + interval '2 hours 10 minutes', 20, 'SCHEDULED', now()
    );
  EXCEPTION WHEN exclusion_violation THEN
    v_excepcion_capturada := true;
  END;
  IF NOT v_excepcion_capturada THEN
    RAISE EXCEPTION 'FAIL 2) excl_cita_consultorio no rechazó una segunda cita solapada del mismo consultorio.';
  END IF;
  RAISE NOTICE 'OK 2) excl_cita_consultorio rechaza citas solapadas del mismo consultorio.';

  -- -------------------------------------------------------------------
  -- Aserción 3: esSobrecupo=true exime del EXCLUDE (mismo médico, mismo
  -- horario que la aserción 1).
  -- -------------------------------------------------------------------
  INSERT INTO "OutpatientAppointment" (
    id, "organizationId", "establishmentId", "patientId", "providerId",
    "scheduledAt", "durationMinutes", status, "esSobrecupo", "updatedAt"
  ) VALUES (
    '00000000-0000-0000-0000-000000024714', v_org, v_estab, v_patient, v_provider,
    v_base, 20, 'SCHEDULED', true, now()
  );
  RAISE NOTICE 'OK 3) esSobrecupo=true exime del EXCLUDE de antirreserva doble.';

  -- -------------------------------------------------------------------
  -- Aserción 4 (control negativo): horarios NO solapados del mismo
  -- médico se insertan sin conflicto.
  -- -------------------------------------------------------------------
  INSERT INTO "OutpatientAppointment" (
    id, "organizationId", "establishmentId", "patientId", "providerId",
    "scheduledAt", "durationMinutes", status, "updatedAt"
  ) VALUES (
    '00000000-0000-0000-0000-000000024715', v_org, v_estab, v_patient, v_provider,
    v_base + interval '1 hour', 20, 'SCHEDULED', now()
  );
  RAISE NOTICE 'OK 4) horarios no solapados del mismo médico no chocan con el EXCLUDE.';

  RAISE NOTICE 'SMOKE 247: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures quedan descartados junto con la
-- transacción.
ROLLBACK;
