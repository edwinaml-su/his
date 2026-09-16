-- =====================================================================
-- 246_cc0036_agenda_core_smoke.sql
-- Smoke test transaccional de 246_cc0036_agenda_core.sql (CC-0036 Ola 3 —
-- motor de agenda, REQ-HIS-AFIL-001 §6.1 Bloque E2). Ejercita
-- `fn_agenda_disponibilidad` con los casos dorados del REQ §12: jornada
-- semanal simple, feriado, excepción EXTENSION (incluso en feriado),
-- excepción BLOQUEO, e intersección con ContratoJornada (COMPARTIDO_POR_JORNADA).
--
-- Requiere que 246_cc0036_agenda_core.sql YA esté aplicado (AgendaMedico/
-- AgendaHorario/AgendaExcepcion/ListaEspera + fn_agenda_disponibilidad
-- presentes), además de sql/244 (Consultorio/MedicoAfiliado) y sql/245
-- (ContratoArrendamiento/ContratoJornada). Corre 100% dentro de UNA
-- transacción que termina en ROLLBACK — no persiste ninguna fila. No demota
-- a rol `authenticated` — ejercita la LÓGICA de negoción de la función (es
-- SECURITY INVOKER, pero como esta sesión corre con el rol propietario
-- (BYPASSRLS), no hace falta demotar para probar el cálculo de slots en sí;
-- RLS se prueba aparte). Mismo patrón que 245_cc0036_contratos_smoke.sql.
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/246_cc0036_agenda_core.sql
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/246_cc0036_agenda_core_smoke.sql
--
-- Qué verifica:
--   1. Horario semanal simple (08:00-10:00, slot 60min) -> 2 slots, cada uno
--      capacidad=1/ocupados=0/disponible=1.
--   2. Feriado nacional ese día -> 0 slots (paso 3 del REQ).
--   3. Excepción EXTENSION 18:00-19:00 el mismo día feriado -> 1 slot (18-19)
--      — la extensión SUMA incluso en feriado (ver diseño en cabecera sql/246).
--   4. Excepción BLOQUEO de día completo en otra fecha -> 0 slots.
--   5. Contrato COMPARTIDO_POR_JORNADA con jornada 09:00-10:00 el mismo día
--      de la semana -> la agenda con horario 08:00-10:00 queda intersectada
--      a solo 09:00-10:00 (1 slot).
-- =====================================================================

BEGIN;

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

-- ---------------------------------------------------------------------
-- Fixtures base — misma convención que 245_cc0036_contratos_smoke.sql.
-- ---------------------------------------------------------------------
INSERT INTO smoke_ids (key, value)
SELECT 'org', o.id
FROM "Organization" o
WHERE EXISTS (SELECT 1 FROM "Establishment" e WHERE e."organizationId" = o.id)
LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key = 'org') = 0 THEN
    RAISE EXCEPTION 'Smoke 246 requiere >=1 Organization con Establishment — no encontrada. Corre npm run db:seed primero.';
  END IF;
END $$;

INSERT INTO smoke_ids (key, value)
SELECT 'estab', id FROM "Establishment"
 WHERE "organizationId" = (SELECT value FROM smoke_ids WHERE key = 'org')
 LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'currency', id FROM "Currency" WHERE "isoCode" = 'USD' LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key = 'currency') = 0 THEN
    RAISE EXCEPTION 'Smoke 246 requiere Currency USD sembrada.';
  END IF;
END $$;

INSERT INTO smoke_ids (key, value)
SELECT 'country', "countryId" FROM "Organization" WHERE id = (SELECT value FROM smoke_ids WHERE key='org');

-- Consultorio + MedicoAfiliado (sin userId — sin bridge a citas, no hace
-- falta para este smoke que solo prueba pasos 1-4 y la intersección de jornada).
INSERT INTO "Consultorio" (id, "organizationId", "establishmentId", codigo, nombre, "tipoUso")
SELECT '00000000-0000-0000-0000-000000024601', org, estab, 'SMK-246', 'Smoke 246 — Consultorio', 'ARRENDADO'
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='estab') estab) f;

INSERT INTO "MedicoAfiliado" (id, "organizationId", "nombreCompleto", "jvpmNumero", "tipoRelacion")
SELECT '00000000-0000-0000-0000-000000024602', org, 'Smoke 246 — Dr. Prueba', 'SMK-JVPM-246', 'AFILIADO_ARRENDATARIO'
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org) f;

-- Contrato EXCLUSIVO VIGENTE (base, sin jornada) para la agenda #1.
INSERT INTO "ContratoArrendamiento" (
  id, "organizationId", "medicoAfiliadoId", "consultorioId", folio, modalidad,
  "fechaInicio", "rentaMensual", "currencyId", estado
)
SELECT '00000000-0000-0000-0000-000000024610', org, '00000000-0000-0000-0000-000000024602',
       '00000000-0000-0000-0000-000000024601', 'ARR-SMK246-1', 'EXCLUSIVO', '2020-01-01', 1000.00, currency, 'VIGENTE'
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='currency') currency) f;

-- Agenda #1: vigente desde 2020, horizonte amplio, sin anticipación mínima,
-- slot de 60 min, capacidad 1.
INSERT INTO "AgendaMedico" (
  id, "organizationId", "establishmentId", "medicoAfiliadoId", "consultorioId", "contratoId",
  "vigenciaDesde", "duracionSlotMin", "capacidadPorSlot", "anticipacionMinimaHoras", "horizonteMaximoDias", estado
)
SELECT '00000000-0000-0000-0000-000000024620', org, estab, '00000000-0000-0000-0000-000000024602',
       '00000000-0000-0000-0000-000000024601', '00000000-0000-0000-0000-000000024610',
       '2020-01-01', 60, 1, 0, 3650, 'PUBLICADA'
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='estab') estab) f;

-- ---------------------------------------------------------------------
-- Fecha de prueba: 30 días en el futuro desde HOY (evita el filtro de
-- anticipación/horizonte y garantiza que "hoy" nunca la alcance en CI).
-- v_dia_semana se calcula dinámicamente — no asumimos qué día de la semana es.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fecha_normal date := current_date + 30;
  v_fecha_feriado date := current_date + 37; -- otra semana, mismo día de semana que v_fecha_normal
  v_dia_semana smallint;
  v_rows int;
BEGIN
  v_dia_semana := EXTRACT(DOW FROM v_fecha_normal)::smallint;

  -- Horario semanal 08:00-10:00 para v_dia_semana.
  INSERT INTO "AgendaHorario" (id, "agendaId", "diaSemana", "horaInicio", "horaFin")
  VALUES ('00000000-0000-0000-0000-000000024630', '00000000-0000-0000-0000-000000024620', v_dia_semana, '08:00', '10:00');

  -- ---------------------------------------------------------------------
  -- Aserción 1: horario simple -> 2 slots de 60 min, capacidad/ocupados/disponible correctos.
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO v_rows
    FROM public.fn_agenda_disponibilidad('00000000-0000-0000-0000-000000024620', v_fecha_normal, v_fecha_normal)
   WHERE capacidad = 1 AND ocupados = 0 AND disponible = 1;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'FAIL 1) esperaba 2 slots libres de 60min en el horario 08:00-10:00, obtuvo %.', v_rows;
  END IF;
  RAISE NOTICE 'OK 1) horario semanal simple produce 2 slots de 60min (capacidad=1/ocupados=0/disponible=1).';

  -- ---------------------------------------------------------------------
  -- Aserción 2: feriado nacional ese día -> 0 slots.
  -- ---------------------------------------------------------------------
  INSERT INTO "Holiday" (id, "countryId", date, name, kind)
  VALUES (gen_random_uuid(), (SELECT value FROM smoke_ids WHERE key='country'), v_fecha_feriado, 'Smoke 246 — Feriado', 'nacional');

  SELECT count(*) INTO v_rows
    FROM public.fn_agenda_disponibilidad('00000000-0000-0000-0000-000000024620', v_fecha_feriado, v_fecha_feriado);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL 2) esperaba 0 slots en día feriado, obtuvo %.', v_rows;
  END IF;
  RAISE NOTICE 'OK 2) feriado nacional anula el horario base del día.';

  -- ---------------------------------------------------------------------
  -- Aserción 3: excepción EXTENSION 18:00-19:00 el MISMO día feriado -> 1 slot (18-19).
  -- ---------------------------------------------------------------------
  INSERT INTO "AgendaExcepcion" (id, "agendaId", fecha, tipo, "horaInicio", "horaFin", motivo, "createdBy")
  VALUES (
    '00000000-0000-0000-0000-000000024640', '00000000-0000-0000-0000-000000024620', v_fecha_feriado,
    'EXTENSION', '18:00', '19:00', 'Smoke 246 — cupos extra en feriado', gen_random_uuid()
  );

  SELECT count(*) INTO v_rows
    FROM public.fn_agenda_disponibilidad('00000000-0000-0000-0000-000000024620', v_fecha_feriado, v_fecha_feriado)
   WHERE (inicio AT TIME ZONE 'America/El_Salvador')::time = '18:00:00' AND (fin AT TIME ZONE 'America/El_Salvador')::time = '19:00:00' AND disponible = 1;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL 3) esperaba 1 slot 18:00-19:00 por la excepción EXTENSION (incluso en feriado), obtuvo %.', v_rows;
  END IF;
  RAISE NOTICE 'OK 3) excepción EXTENSION suma disponibilidad incluso en día feriado.';

  -- ---------------------------------------------------------------------
  -- Aserción 4: excepción BLOQUEO de día completo en v_fecha_normal + 14
  -- (misma día de semana, fecha distinta de v_fecha_feriado = +37 para no
  -- mezclar el fixture del feriado/extensión con este caso) -> 0 slots.
  -- ---------------------------------------------------------------------
  INSERT INTO "AgendaExcepcion" (id, "agendaId", fecha, tipo, motivo, "createdBy")
  VALUES (
    '00000000-0000-0000-0000-000000024641', '00000000-0000-0000-0000-000000024620', v_fecha_normal + 14,
    'BLOQUEO', 'Smoke 246 — bloqueo de día completo', gen_random_uuid()
  );

  SELECT count(*) INTO v_rows
    FROM public.fn_agenda_disponibilidad('00000000-0000-0000-0000-000000024620', v_fecha_normal + 14, v_fecha_normal + 14);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL 4) esperaba 0 slots por BLOQUEO de día completo, obtuvo %.', v_rows;
  END IF;
  RAISE NOTICE 'OK 4) excepción BLOQUEO de día completo anula toda la disponibilidad del día.';

  -- ---------------------------------------------------------------------
  -- Aserción 5: agenda #2 sobre contrato COMPARTIDO_POR_JORNADA con jornada
  -- 09:00-10:00 el mismo día de semana -> horario 08:00-10:00 se intersecta
  -- a solo 09:00-10:00 (1 slot).
  -- ---------------------------------------------------------------------
  INSERT INTO "ContratoArrendamiento" (
    id, "organizationId", "medicoAfiliadoId", "consultorioId", folio, modalidad,
    "fechaInicio", "rentaMensual", "currencyId", estado
  )
  SELECT '00000000-0000-0000-0000-000000024611', org, '00000000-0000-0000-0000-000000024602',
         '00000000-0000-0000-0000-000000024601', 'ARR-SMK246-2', 'COMPARTIDO_POR_JORNADA', '2020-01-01', 1000.00, currency, 'VIGENTE'
    FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='currency') currency) f;

  INSERT INTO "ContratoJornada" (id, "contratoId", "diaSemana", "horaInicio", "horaFin")
  VALUES ('00000000-0000-0000-0000-000000024650', '00000000-0000-0000-0000-000000024611', v_dia_semana, '09:00', '10:00');

  INSERT INTO "AgendaMedico" (
    id, "organizationId", "establishmentId", "medicoAfiliadoId", "consultorioId", "contratoId",
    "vigenciaDesde", "duracionSlotMin", "capacidadPorSlot", "anticipacionMinimaHoras", "horizonteMaximoDias", estado
  )
  SELECT '00000000-0000-0000-0000-000000024621', org, estab, '00000000-0000-0000-0000-000000024602',
         '00000000-0000-0000-0000-000000024601', '00000000-0000-0000-0000-000000024611',
         '2020-01-01', 60, 1, 0, 3650, 'PUBLICADA'
    FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='estab') estab) f;

  INSERT INTO "AgendaHorario" (id, "agendaId", "diaSemana", "horaInicio", "horaFin")
  VALUES ('00000000-0000-0000-0000-000000024631', '00000000-0000-0000-0000-000000024621', v_dia_semana, '08:00', '10:00');

  SELECT count(*) INTO v_rows
    FROM public.fn_agenda_disponibilidad('00000000-0000-0000-0000-000000024621', v_fecha_normal, v_fecha_normal);
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL 5) esperaba 1 slot (intersección con jornada 09:00-10:00), obtuvo %.', v_rows;
  END IF;

  SELECT count(*) INTO v_rows
    FROM public.fn_agenda_disponibilidad('00000000-0000-0000-0000-000000024621', v_fecha_normal, v_fecha_normal)
   WHERE (inicio AT TIME ZONE 'America/El_Salvador')::time = '09:00:00' AND (fin AT TIME ZONE 'America/El_Salvador')::time = '10:00:00';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL 5b) el slot resultante debía ser exactamente 09:00-10:00, obtuvo %.', v_rows;
  END IF;
  RAISE NOTICE 'OK 5) intersección con ContratoJornada acota el horario al tramo contratado.';

  RAISE NOTICE 'SMOKE 246: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures quedan descartados junto con la
-- transacción.
ROLLBACK;
