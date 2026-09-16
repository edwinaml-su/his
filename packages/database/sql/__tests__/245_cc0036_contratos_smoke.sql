-- =====================================================================
-- 245_cc0036_contratos_smoke.sql
-- Smoke test transaccional de 245_cc0036_contratos.sql (CC-0036 Ola 2 —
-- contratos de arrendamiento y devengo, REQ-HIS-AFIL-001 §5.1 Bloque A).
--
-- Requiere que 245_cc0036_contratos.sql YA esté aplicado en la sesión/BD
-- (ContratoArrendamiento/ContratoJornada/ContratoCargo + fn_next_
-- contrato_arrendamiento presentes; btree_gist ya instalada por sql/243).
-- Corre 100% dentro de UNA transacción que termina en ROLLBACK — no persiste
-- ninguna fila. No demota a rol `authenticated` — ejercita la LÓGICA de
-- negocio (EXCLUDE de traslape EXCLUSIVO, UNIQUE de idempotencia del cargo,
-- CHECK de jornada, folio atómico), no RLS. Mismo patrón que
-- 243_cc0036_turnos_smoke.sql.
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/245_cc0036_contratos.sql
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/245_cc0036_contratos_smoke.sql
--
-- Qué verifica:
--   1. fn_next_contrato_arrendamiento devuelve 1, 2, 3... por organización.
--   2. Un contrato EXCLUSIVO VIGENTE + un segundo EXCLUSIVO VIGENTE con
--      fechas traslapadas sobre el MISMO consultorio -> exclusion_violation.
--   3. Un contrato EXCLUSIVO en BORRADOR con fechas traslapadas sobre el
--      mismo consultorio SÍ se inserta (el EXCLUDE con WHERE parcial no
--      evalúa filas cuyo estado no satisface el predicado) — documenta por
--      qué la validación de traslape en `create` es responsabilidad del
--      router, no de este constraint (ver cabecera de sql/245).
--   4. ContratoCargo UNIQUE(contratoId, periodo, concepto): un segundo INSERT
--      con la misma terna -> unique_violation (idempotencia del devengo).
--   5. ContratoJornada CHECK horaFin>horaInicio rechaza un rango invertido.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

-- ---------------------------------------------------------------------
-- Fixtures base — cualquier Organization con Establishment sembrado +
-- Currency USD (mismo patrón que 204_motor_precios_smoke.sql).
-- ---------------------------------------------------------------------
INSERT INTO smoke_ids (key, value)
SELECT 'org', o.id
FROM "Organization" o
WHERE EXISTS (SELECT 1 FROM "Establishment" e WHERE e."organizationId" = o.id)
LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key = 'org') = 0 THEN
    RAISE EXCEPTION 'Smoke 245 requiere >=1 Organization con Establishment — no encontrada. Corre npm run db:seed primero.';
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
    RAISE EXCEPTION 'Smoke 245 requiere Currency USD sembrada.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Fixture: 1 Consultorio + 1 MedicoAfiliado (para colgar los contratos).
-- ---------------------------------------------------------------------
INSERT INTO "Consultorio" (id, "organizationId", "establishmentId", codigo, nombre, "tipoUso")
SELECT '00000000-0000-0000-0000-000000024501', org, estab, 'SMK-245', 'Smoke 245 — Consultorio', 'ARRENDADO'
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='estab') estab) f;

INSERT INTO "MedicoAfiliado" (id, "organizationId", "nombreCompleto", "jvpmNumero", "tipoRelacion")
SELECT '00000000-0000-0000-0000-000000024502', org, 'Smoke 245 — Dr. Prueba', 'SMK-JVPM-245', 'AFILIADO_ARRENDATARIO'
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org) f;

-- ---------------------------------------------------------------------
-- Aserción 1: fn_next_contrato_arrendamiento — correlativo atómico por org.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid := (SELECT value FROM smoke_ids WHERE key = 'org');
  v1 int;
  v2 int;
BEGIN
  v1 := public.fn_next_contrato_arrendamiento(v_org);
  v2 := public.fn_next_contrato_arrendamiento(v_org);
  IF v2 <> v1 + 1 THEN
    RAISE EXCEPTION 'FAIL 1) fn_next_contrato_arrendamiento: esperaba incremento consecutivo, obtuvo % -> %.', v1, v2;
  END IF;
  RAISE NOTICE 'OK 1) fn_next_contrato_arrendamiento incrementa atómicamente (% -> %).', v1, v2;
END $$;

-- ---------------------------------------------------------------------
-- Aserción 2: EXCLUSIVO + VIGENTE traslapado sobre el mismo consultorio ->
-- exclusion_violation.
-- ---------------------------------------------------------------------
INSERT INTO "ContratoArrendamiento" (
  id, "organizationId", "medicoAfiliadoId", "consultorioId", folio, modalidad,
  "fechaInicio", "fechaFin", "rentaMensual", "currencyId", estado
)
SELECT
  '00000000-0000-0000-0000-000000024510', org, medico, consultorio, 'ARR-SMK245-1',
  'EXCLUSIVO', '2026-01-01', '2026-12-31', 1000.00, currency, 'VIGENTE'
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key='org') org,
          (SELECT value FROM smoke_ids WHERE key='currency') currency,
          '00000000-0000-0000-0000-000000024501'::uuid consultorio,
          '00000000-0000-0000-0000-000000024502'::uuid medico
       ) f;

DO $$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO "ContratoArrendamiento" (
      id, "organizationId", "medicoAfiliadoId", "consultorioId", folio, modalidad,
      "fechaInicio", "fechaFin", "rentaMensual", "currencyId", estado
    )
    SELECT
      '00000000-0000-0000-0000-000000024511', org, medico, consultorio, 'ARR-SMK245-2',
      'EXCLUSIVO', '2026-06-01', '2026-06-30', 1200.00, currency, 'VIGENTE'
      FROM (SELECT
              (SELECT value FROM smoke_ids WHERE key='org') org,
              (SELECT value FROM smoke_ids WHERE key='currency') currency,
              '00000000-0000-0000-0000-000000024501'::uuid consultorio,
              '00000000-0000-0000-0000-000000024502'::uuid medico
           ) f;
  EXCEPTION WHEN exclusion_violation THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL 2) esperaba exclusion_violation por traslape EXCLUSIVO/VIGENTE sobre el mismo consultorio.';
  END IF;
  RAISE NOTICE 'OK 2) excl_contrato_arrendamiento_exclusivo rechaza el traslape EXCLUSIVO/VIGENTE.';
END $$;

-- ---------------------------------------------------------------------
-- Aserción 3: el mismo traslape, pero en BORRADOR, SÍ se inserta (el EXCLUDE
-- con WHERE parcial no evalúa filas que no satisfacen el predicado).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO "ContratoArrendamiento" (
      id, "organizationId", "medicoAfiliadoId", "consultorioId", folio, modalidad,
      "fechaInicio", "fechaFin", "rentaMensual", "currencyId", estado
    )
    SELECT
      '00000000-0000-0000-0000-000000024512', org, medico, consultorio, 'ARR-SMK245-3',
      'EXCLUSIVO', '2026-06-01', '2026-06-30', 1200.00, currency, 'BORRADOR'
      FROM (SELECT
              (SELECT value FROM smoke_ids WHERE key='org') org,
              (SELECT value FROM smoke_ids WHERE key='currency') currency,
              '00000000-0000-0000-0000-000000024501'::uuid consultorio,
              '00000000-0000-0000-0000-000000024502'::uuid medico
           ) f;
    v_ok := true;
  EXCEPTION WHEN exclusion_violation THEN
    v_ok := false;
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'FAIL 3) un contrato EXCLUSIVO en BORRADOR traslapado NO debería disparar el EXCLUDE (predicado no satisfecho).';
  END IF;
  RAISE NOTICE 'OK 3) BORRADOR traslapado se inserta sin disparar el EXCLUDE (validación de create es responsabilidad del router).';
END $$;

-- ---------------------------------------------------------------------
-- Aserción 4: ContratoCargo UNIQUE(contratoId, periodo, concepto) —
-- idempotencia del devengo.
-- ---------------------------------------------------------------------
INSERT INTO "ContratoCargo" (
  id, "organizationId", "contratoId", periodo, concepto, monto, "currencyId", estado
)
SELECT
  '00000000-0000-0000-0000-000000024520', org, '00000000-0000-0000-0000-000000024510', '2026-01-01', 'RENTA', 1000.00, currency, 'DEVENGADO'
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='currency') currency) f;

DO $$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO "ContratoCargo" (
      id, "organizationId", "contratoId", periodo, concepto, monto, "currencyId", estado
    )
    SELECT
      '00000000-0000-0000-0000-000000024521', org, '00000000-0000-0000-0000-000000024510', '2026-01-01', 'RENTA', 1000.00, currency, 'DEVENGADO'
      FROM (SELECT (SELECT value FROM smoke_ids WHERE key='org') org, (SELECT value FROM smoke_ids WHERE key='currency') currency) f;
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL 4) esperaba unique_violation por (contratoId, periodo, concepto) duplicado.';
  END IF;
  RAISE NOTICE 'OK 4) ContratoCargo_contratoId_periodo_concepto_key da idempotencia al devengo.';
END $$;

-- ---------------------------------------------------------------------
-- Aserción 5: ContratoJornada CHECK horaFin>horaInicio.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO "ContratoJornada" (id, "contratoId", "diaSemana", "horaInicio", "horaFin")
    VALUES ('00000000-0000-0000-0000-000000024530', '00000000-0000-0000-0000-000000024510', 2, '18:00', '14:00');
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FAIL 5) esperaba check_violation por horaFin <= horaInicio en ContratoJornada.';
  END IF;
  RAISE NOTICE 'OK 5) chk_contrato_jornada_rango rechaza horaFin <= horaInicio.';
  RAISE NOTICE 'SMOKE 245: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures quedan descartados junto con la
-- transacción.
ROLLBACK;
