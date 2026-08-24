-- =====================================================================
-- 208_drift_columnas_faltantes_smoke.sql
-- Smoke test transaccional de 208_drift_columnas_faltantes.sql.
--
-- Requiere que 208_drift_columnas_faltantes.sql YA esté aplicado en la
-- sesión/BD contra la que se corre este archivo. Corre 100% dentro de UNA
-- transacción que termina en ROLLBACK — no persiste ninguna fila.
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/208_drift_columnas_faltantes.sql
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/208_drift_columnas_faltantes_smoke.sql
--   (o ambos dentro de un mismo BEGIN...ROLLBACK, ver docstring de @DBA)
--
-- Falla ruidosamente (RAISE EXCEPTION, aborta la transacción) ante
-- cualquier aserción incumplida — no hay asserts silenciosos.
--
-- Qué verifica, un caso a la vez, reproduciendo la forma exacta en que el
-- código de aplicación toca cada columna:
--   1. ClinicalNote.editHistory — INSERT con array editHistory (igual que
--      ehr-notes.router.ts create/addendum) + UPDATE reescribiendo el
--      historial (igual que update). Verifica JSONB persistido y legible.
--   2. DietPlan.allergens — INSERT sin especificar allergens (default
--      '{}' NOT NULL) + INSERT con array explícito. Verifica que
--      nutrition.router.ts (findAllergyConflicts) podría filtrar sobre
--      plan.allergens sin excepción.
--   3. PharmacyReservation.cancelMotivo + .updatedAt — INSERT RESERVED +
--      UPDATE a CANCELLED con cancelMotivo (igual que cancelReservation
--      en pharmacy-dispensation.router.ts). Verifica que el trigger
--      preexistente trg_pharma_reservation_updated_at (que ya hacía
--      NEW."updatedAt" = now() contra una columna inexistente) corre sin
--      excepción ahora que la columna existe.
--   4. AuditDashboardConfig.outlierAlertEnabled — INSERT con el DEFAULT
--      true + UPDATE a false (igual que audit-outlier.router.ts
--      getConfig/upsertConfig, aunque esos usan $queryRaw — se reproduce
--      el mismo INSERT/UPDATE en SQL plano).
-- =====================================================================

BEGIN;

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

-- Fixture base: un Encounter real (trae organizationId + patientId
-- consistentes) y un User real (autor de nota clínica).
INSERT INTO smoke_ids (key, value)
SELECT 'encounter', id FROM public."Encounter" LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'org', "organizationId" FROM public."Encounter"
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'encounter');

INSERT INTO smoke_ids (key, value)
SELECT 'patient', "patientId" FROM public."Encounter"
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'encounter');

INSERT INTO smoke_ids (key, value)
SELECT 'user', id FROM public."User" LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids WHERE key IN ('encounter', 'org', 'patient', 'user')) < 4 THEN
    RAISE EXCEPTION
      'Smoke test requiere al menos 1 fila en Encounter y User — no encontradas. Abortando.';
  END IF;
END $$;

-- -----------------------------------------------------------------
-- 1) ClinicalNote.editHistory
-- -----------------------------------------------------------------
DO $$
DECLARE
  v_org      uuid := (SELECT value FROM smoke_ids WHERE key = 'org');
  v_enc      uuid := (SELECT value FROM smoke_ids WHERE key = 'encounter');
  v_user     uuid := (SELECT value FROM smoke_ids WHERE key = 'user');
  v_note_id  uuid;
  v_history  jsonb;
BEGIN
  INSERT INTO public."ClinicalNote"
    (id, "organizationId", "encounterId", "authorId", "noteType",
     subjective, "editHistory", "updatedAt")
  VALUES
    (gen_random_uuid(), v_org, v_enc, v_user, 'PROGRESS'::public."NoteType",
     'smoke-208 subjective',
     jsonb_build_array(jsonb_build_object('at', now(), 'by', v_user, 'action', 'create')),
     now())
  RETURNING id INTO v_note_id;

  SELECT "editHistory" INTO v_history FROM public."ClinicalNote" WHERE id = v_note_id;
  IF v_history IS NULL OR jsonb_array_length(v_history) <> 1 THEN
    RAISE EXCEPTION 'FAIL 1) editHistory no persistió el array esperado (id=%): %', v_note_id, v_history;
  END IF;

  -- Simula ehr-notes.router.ts update: lee editHistory, arma entrada nueva, reescribe.
  UPDATE public."ClinicalNote"
     SET "editHistory" = "editHistory" || jsonb_build_array(
           jsonb_build_object('at', now(), 'by', v_user, 'action', 'update', 'diff', jsonb_build_object('subjective', 'smoke-208 subjective'))
         )
   WHERE id = v_note_id;

  SELECT "editHistory" INTO v_history FROM public."ClinicalNote" WHERE id = v_note_id;
  IF jsonb_array_length(v_history) <> 2 THEN
    RAISE EXCEPTION 'FAIL 1) editHistory no acumuló la segunda entrada (id=%): %', v_note_id, v_history;
  END IF;

  RAISE NOTICE 'OK 1) ClinicalNote.editHistory: create + update acumulan historial JSONB (id=%).', v_note_id;
END $$;

-- -----------------------------------------------------------------
-- 2) DietPlan.allergens
-- -----------------------------------------------------------------
DO $$
DECLARE
  v_org         uuid := (SELECT value FROM smoke_ids WHERE key = 'org');
  v_enc         uuid := (SELECT value FROM smoke_ids WHERE key = 'encounter');
  v_patient     uuid := (SELECT value FROM smoke_ids WHERE key = 'patient');
  v_plan_id     uuid;
  v_allergens   text[];
BEGIN
  -- Sin especificar allergens: debe tomar el DEFAULT '{}' NOT NULL.
  -- (updatedAt no tiene DEFAULT a nivel BD — lo gestiona @updatedAt en
  -- Prisma en runtime real; aquí se provee explícito para el smoke SQL.)
  INSERT INTO public."DietPlan" (id, "organizationId", "encounterId", "patientId", "dietType", "updatedAt")
  VALUES (gen_random_uuid(), v_org, v_enc, v_patient, 'REGULAR'::public."DietType", now())
  RETURNING id INTO v_plan_id;

  SELECT allergens INTO v_allergens FROM public."DietPlan" WHERE id = v_plan_id;
  IF v_allergens IS NULL OR array_length(v_allergens, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 2) DietPlan.allergens default no fue {} (id=%): %', v_plan_id, v_allergens;
  END IF;

  -- Con allergens explícito (igual que el plan usado por findAllergyConflicts).
  UPDATE public."DietPlan" SET allergens = ARRAY['NUTS', 'DAIRY'] WHERE id = v_plan_id;

  SELECT allergens INTO v_allergens FROM public."DietPlan" WHERE id = v_plan_id;
  IF v_allergens IS DISTINCT FROM ARRAY['NUTS', 'DAIRY'] THEN
    RAISE EXCEPTION 'FAIL 2) DietPlan.allergens no persistió el array explícito (id=%): %', v_plan_id, v_allergens;
  END IF;

  RAISE NOTICE 'OK 2) DietPlan.allergens: default {} en INSERT + array explícito en UPDATE (id=%).', v_plan_id;
END $$;

-- -----------------------------------------------------------------
-- 3) PharmacyReservation.cancelMotivo + .updatedAt
--    (incluye fixture PharmacyOrder — prod tiene 0 filas hoy).
-- -----------------------------------------------------------------
DO $$
DECLARE
  v_org           uuid := (SELECT value FROM smoke_ids WHERE key = 'org');
  v_enc           uuid := (SELECT value FROM smoke_ids WHERE key = 'encounter');
  v_patient       uuid := (SELECT value FROM smoke_ids WHERE key = 'patient');
  v_order_id      uuid;
  v_reservation_id uuid;
  v_row           public."PharmacyReservation"%ROWTYPE;
BEGIN
  INSERT INTO public."PharmacyOrder"
    (id, "organizationId", "encounterId", "patientId", "glnOrigen", "glnDestino")
  VALUES
    (gen_random_uuid(), v_org, v_enc, v_patient, '7501234567890', '7509876543210')
  RETURNING id INTO v_order_id;

  INSERT INTO public."PharmacyReservation"
    (id, "organizationId", "pharmacyOrderId", "patientId", gtin, lote, "expiresAt")
  VALUES
    (gen_random_uuid(), v_org, v_order_id, v_patient, '07501234567895', 'LOTE-SMOKE-208', now() + interval '4 hours')
  RETURNING id INTO v_reservation_id;

  -- Simula cancelReservation: status → CANCELLED + cancelMotivo. Este UPDATE
  -- es exactamente el que dispara trg_pharma_reservation_updated_at — antes
  -- de este archivo, esa columna no existía y el trigger reventaba con
  -- "record 'new' has no field 'updatedAt'" en CUALQUIER UPDATE, no solo este.
  UPDATE public."PharmacyReservation"
     SET status = 'CANCELLED', "cancelMotivo" = 'Cancelado por smoke test 208'
   WHERE id = v_reservation_id;

  SELECT * INTO v_row FROM public."PharmacyReservation" WHERE id = v_reservation_id;
  IF v_row.status <> 'CANCELLED' OR v_row."cancelMotivo" <> 'Cancelado por smoke test 208' THEN
    RAISE EXCEPTION 'FAIL 3) cancelReservation no persistió status/cancelMotivo (id=%): status=%, cancelMotivo=%',
      v_reservation_id, v_row.status, v_row."cancelMotivo";
  END IF;
  IF v_row."updatedAt" IS NULL THEN
    RAISE EXCEPTION 'FAIL 3) trg_pharma_reservation_updated_at no dejó updatedAt seteado (id=%).', v_reservation_id;
  END IF;

  RAISE NOTICE 'OK 3) PharmacyReservation.cancelMotivo + .updatedAt: cancelReservation y el trigger preexistente corren sin excepción (id=%).', v_reservation_id;
END $$;

-- -----------------------------------------------------------------
-- 4) AuditDashboardConfig.outlierAlertEnabled
-- -----------------------------------------------------------------
DO $$
DECLARE
  v_org      uuid := (SELECT value FROM smoke_ids WHERE key = 'org');
  v_enabled  boolean;
BEGIN
  -- ON CONFLICT: la org del fixture puede ya tener config (organizationId es UNIQUE).
  INSERT INTO public."AuditDashboardConfig" (id, "organizationId")
  VALUES (gen_random_uuid(), v_org)
  ON CONFLICT ("organizationId") DO UPDATE SET "outlierAlertEnabled" = true
  RETURNING "outlierAlertEnabled" INTO v_enabled;

  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 4) outlierAlertEnabled no tomó el DEFAULT/valor esperado true (org=%): %', v_org, v_enabled;
  END IF;

  UPDATE public."AuditDashboardConfig" SET "outlierAlertEnabled" = false WHERE "organizationId" = v_org;

  SELECT "outlierAlertEnabled" INTO v_enabled FROM public."AuditDashboardConfig" WHERE "organizationId" = v_org;
  IF v_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL 4) outlierAlertEnabled no persistió el UPDATE a false (org=%): %', v_org, v_enabled;
  END IF;

  RAISE NOTICE 'OK 4) AuditDashboardConfig.outlierAlertEnabled: INSERT default true + UPDATE a false (org=%).', v_org;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'SMOKE 208: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures y filas de prueba quedan
-- descartadas junto con la transacción.
ROLLBACK;
