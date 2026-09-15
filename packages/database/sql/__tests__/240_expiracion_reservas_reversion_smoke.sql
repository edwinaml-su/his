-- =====================================================================
-- 240_expiracion_reservas_reversion_smoke.sql
-- Smoke test transaccional de 240_expiracion_reservas_reversion.sql
-- (auditoría 2026-09-15, hallazgo C7/B23/P0-15).
--
-- Requiere que 240_expiracion_reservas_reversion.sql YA esté aplicado en la
-- sesión/BD contra la que se corre este archivo (que a su vez requiere
-- sql/89, sql/214 y sql/237 ya aplicados). Corre 100% dentro de UNA
-- transacción que termina en ROLLBACK — no persiste ninguna fila.
--
-- Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/240_expiracion_reservas_reversion.sql
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/__tests__/240_expiracion_reservas_reversion_smoke.sql
--
-- No se demota a rol `authenticated` (a diferencia de 209/205): este smoke
-- test NO ejercita RLS, ejercita la LÓGICA de negocio de la función
-- `expire_pharmacy_reservations()` (SECURITY DEFINER) — corre con el rol de
-- conexión (BYPASSRLS), igual que 204_motor_precios_smoke.sql.
--
-- Fixtures: reutiliza una fila EXISTENTE de `Encounter` (y de ahí org/
-- establecimiento/paciente), un `User`, un `Drug` y un `StockItem`
-- cualesquiera — mismo patrón de "cualquier fila real" que
-- 204_motor_precios_smoke.sql, tolerante a que el contenido exacto de
-- catálogos difiera entre dev/CI/prod. Inserta sus PROPIAS filas (con UUIDs
-- fijos 000...024NNN) para StockLot/Prescription/PrescriptionItem/
-- PharmacyReservation/StockMovement/PatientAccount/PatientAccountService —
-- así los valores de partida (cantidad reservada, cargo VIGENTE, dispensedQty
-- parcial) son controlados y las aserciones son deterministas.
--
-- Qué verifica (una reserva RESERVED con expiresAt en el pasado):
--   1. status -> EXPIRED.
--   2. StockLot.quantityOnHand repuesto (+1, la unidad que reserveItem
--      había descontado).
--   3. Nuevo StockMovement IN espejo (razón EXPIRACION_RESERVA).
--   4. El cargo VIGENTE original -> REVERTIDO (nunca se borra).
--   5. Nueva línea PatientAccountService REVERSION con quantity/totalPrice
--      NEGATIVOS, enlazada por reversalOfId.
--   6. PrescriptionItem.dispensedQty -1 (floor 0).
--   7. Prescription.status recomputado (PARTIALLY_DISPENSED -> SIGNED,
--      porque tras el decremento ningún ítem queda con dispensedQty > 0).
--
-- Falla ruidosamente (RAISE EXCEPTION, aborta la transacción) ante
-- cualquier aserción incumplida — no hay asserts silenciosos.
--
-- ⚠️ La función procesa TODAS las reservas RESERVED vencidas de la BD, no
-- solo la fixture de este archivo (mismo alcance que el cron real). Si el
-- entorno ya tiene otras reservas RESERVED vencidas con datos inconsistentes
-- (referencia rota, etc.), este smoke test puede fallar por una fila ajena —
-- correrlo contra una BD de CI/staging razonablemente limpia, igual que
-- 209_cc0026_care_task_smoke.sql asume 2 organizaciones "reales" utilizables.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE smoke_ids (
  key   text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

-- ---------------------------------------------------------------------
-- Fixtures base — reutiliza filas EXISTENTES.
-- ---------------------------------------------------------------------
INSERT INTO smoke_ids (key, value)
SELECT 'encounter', id FROM "Encounter" ORDER BY "createdAt" DESC LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'org', "organizationId" FROM "Encounter"
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'encounter');

INSERT INTO smoke_ids (key, value)
SELECT 'estab', "establishmentId" FROM "Encounter"
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'encounter');

INSERT INTO smoke_ids (key, value)
SELECT 'patient', "patientId" FROM "Encounter"
 WHERE id = (SELECT value FROM smoke_ids WHERE key = 'encounter');

INSERT INTO smoke_ids (key, value)
SELECT 'user_id', id FROM "User" ORDER BY "createdAt" LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'drug', id FROM "Drug" ORDER BY "createdAt" LIMIT 1;

INSERT INTO smoke_ids (key, value)
SELECT 'item', id FROM "StockItem" ORDER BY "createdAt" LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM smoke_ids) < 6 THEN
    RAISE EXCEPTION
      'Smoke test 240 requiere >=1 fila existente de Encounter, User, Drug y '
      'StockItem — no encontradas todas. Abortando.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Fixtures propias (UUIDs fijos, estado de partida controlado).
-- ---------------------------------------------------------------------
INSERT INTO "StockLot" (id, "organizationId", "establishmentId", "itemId", "lotNumber", "quantityOnHand", "updatedAt")
SELECT '00000000-0000-0000-0000-000000024001', org, estab, item, 'SMOKE-LOTE-240', 5, now()
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key = 'org')   AS org,
          (SELECT value FROM smoke_ids WHERE key = 'estab') AS estab,
          (SELECT value FROM smoke_ids WHERE key = 'item')  AS item
       ) f;

INSERT INTO "Prescription" (id, "organizationId", "encounterId", "prescriberId", "patientId", status, "signedAt", "updatedAt")
SELECT '00000000-0000-0000-0000-000000024002', org, encounter, usr, patient, 'PARTIALLY_DISPENSED', now(), now()
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key = 'org')       AS org,
          (SELECT value FROM smoke_ids WHERE key = 'encounter') AS encounter,
          (SELECT value FROM smoke_ids WHERE key = 'user_id')   AS usr,
          (SELECT value FROM smoke_ids WHERE key = 'patient')   AS patient
       ) f;

-- prescribedQty=2, dispensedQty=1 (parcial) — tras el cron debe quedar en 0.
INSERT INTO "PrescriptionItem" (id, "prescriptionId", "drugId", dosage, route, frequency, "prescribedQty", "dispensedQty")
SELECT '00000000-0000-0000-0000-000000024003', '00000000-0000-0000-0000-000000024002', drug, '500mg', 'ORAL', 'BID', 2, 1
  FROM (SELECT (SELECT value FROM smoke_ids WHERE key = 'drug') AS drug) f;

INSERT INTO "PharmacyReservation" (id, "organizationId", "pharmacyOrderId", "patientId", gtin, lote, status, "expiresAt", "prescriptionItemId")
SELECT '00000000-0000-0000-0000-000000024004', org, '00000000-0000-0000-0000-000000024002', patient,
       '07501234567890', 'LOTE-SMOKE-240', 'RESERVED', now() - interval '5 hours',
       '00000000-0000-0000-0000-000000024003'
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key = 'org')     AS org,
          (SELECT value FROM smoke_ids WHERE key = 'patient') AS patient
       ) f;

-- StockMovement OUT que `reserveItem` habría creado al reservar (referenceCode = id de la reserva).
INSERT INTO "StockMovement" (id, "organizationId", "establishmentId", "itemId", "lotId", type, quantity, reason, "referenceCode")
SELECT '00000000-0000-0000-0000-000000024005', org, estab, item,
       '00000000-0000-0000-0000-000000024001', 'OUT', 1,
       'Smoke 240 — fixture: descuento original de reserveItem',
       '00000000-0000-0000-0000-000000024004'
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key = 'org')   AS org,
          (SELECT value FROM smoke_ids WHERE key = 'estab') AS estab,
          (SELECT value FROM smoke_ids WHERE key = 'item')  AS item
       ) f;

INSERT INTO "PatientAccount" (id, "organizationId", "patientId", "numeroCuenta", "encounterId", status)
SELECT '00000000-0000-0000-0000-000000024006', org, patient, 'CTA-SMOKE-240', encounter, 'ABIERTA'
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key = 'org')       AS org,
          (SELECT value FROM smoke_ids WHERE key = 'patient')   AS patient,
          (SELECT value FROM smoke_ids WHERE key = 'encounter') AS encounter
       ) f;

-- Cargo VIGENTE que `capturarCargo` habría creado en reserveItem (referenciaId = id de la reserva).
INSERT INTO "PatientAccountService" (id, "accountId", tipo, descripcion, "encounterId", code, quantity, "unitPrice", "totalPrice", status, origen, "referenciaId", "createdBy", "updatedAt")
SELECT '00000000-0000-0000-0000-000000024007', '00000000-0000-0000-0000-000000024006', 'HOSPITALARIO',
       'Smoke 240 — fixture: cargo VIGENTE de dispensación', encounter, 'SMOKE-DRUG-240', 1, 10.00, 10.00,
       'VIGENTE', 'DISPENSACION_FARMACIA', '00000000-0000-0000-0000-000000024004', usr, now()
  FROM (SELECT
          (SELECT value FROM smoke_ids WHERE key = 'encounter') AS encounter,
          (SELECT value FROM smoke_ids WHERE key = 'user_id')   AS usr
       ) f;

-- ---------------------------------------------------------------------
-- Ejecutar el cron (una corrida = una reserva vencida en el lote).
-- ---------------------------------------------------------------------
SELECT public.expire_pharmacy_reservations();

-- ---------------------------------------------------------------------
-- Aserciones.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_reservation_status   text;
  v_lot_qty              numeric;
  v_in_movement_count    int;
  v_cargo_status         text;
  v_reversion_quantity   numeric;
  v_reversion_total      numeric;
  v_reversion_of         uuid;
  v_item_dispensed_qty   numeric;
  v_prescription_status  text;
BEGIN
  SELECT status::text INTO v_reservation_status
    FROM "PharmacyReservation" WHERE id = '00000000-0000-0000-0000-000000024004';
  IF v_reservation_status <> 'EXPIRED' THEN
    RAISE EXCEPTION 'FAIL 1) status esperado EXPIRED, fue %', v_reservation_status;
  END IF;
  RAISE NOTICE 'OK 1) PharmacyReservation.status = EXPIRED.';

  SELECT "quantityOnHand" INTO v_lot_qty
    FROM "StockLot" WHERE id = '00000000-0000-0000-0000-000000024001';
  IF v_lot_qty <> 6 THEN
    RAISE EXCEPTION 'FAIL 2) StockLot.quantityOnHand esperado 6 (5 + 1 repuesto), fue %', v_lot_qty;
  END IF;
  RAISE NOTICE 'OK 2) StockLot.quantityOnHand repuesto (5 -> 6).';

  SELECT count(*) INTO v_in_movement_count
    FROM "StockMovement"
   WHERE "referenceCode" = '00000000-0000-0000-0000-000000024004'
     AND type = 'IN'
     AND reason ILIKE '%EXPIRACION_RESERVA%';
  IF v_in_movement_count <> 1 THEN
    RAISE EXCEPTION 'FAIL 3) esperado 1 StockMovement IN espejo con razón EXPIRACION_RESERVA, encontrados %', v_in_movement_count;
  END IF;
  RAISE NOTICE 'OK 3) StockMovement IN espejo creado (EXPIRACION_RESERVA).';

  SELECT status::text INTO v_cargo_status
    FROM "PatientAccountService" WHERE id = '00000000-0000-0000-0000-000000024007';
  IF v_cargo_status <> 'REVERTIDO' THEN
    RAISE EXCEPTION 'FAIL 4) cargo original esperado REVERTIDO, fue %', v_cargo_status;
  END IF;
  RAISE NOTICE 'OK 4) Cargo original -> REVERTIDO (no se borró).';

  SELECT quantity, "totalPrice", "reversalOfId" INTO v_reversion_quantity, v_reversion_total, v_reversion_of
    FROM "PatientAccountService"
   WHERE "reversalOfId" = '00000000-0000-0000-0000-000000024007'
     AND status = 'REVERSION';
  IF v_reversion_of IS NULL THEN
    RAISE EXCEPTION 'FAIL 5) no se encontró la línea REVERSION enlazada por reversalOfId.';
  END IF;
  IF v_reversion_quantity <> -1 OR v_reversion_total <> -10.00 THEN
    RAISE EXCEPTION 'FAIL 5) línea REVERSION esperaba quantity=-1/totalPrice=-10.00, fue quantity=%/totalPrice=%', v_reversion_quantity, v_reversion_total;
  END IF;
  RAISE NOTICE 'OK 5) Línea REVERSION creada con signo negativo, enlazada por reversalOfId.';

  SELECT "dispensedQty" INTO v_item_dispensed_qty
    FROM "PrescriptionItem" WHERE id = '00000000-0000-0000-0000-000000024003';
  IF v_item_dispensed_qty <> 0 THEN
    RAISE EXCEPTION 'FAIL 6) PrescriptionItem.dispensedQty esperado 0 (1 - 1), fue %', v_item_dispensed_qty;
  END IF;
  RAISE NOTICE 'OK 6) PrescriptionItem.dispensedQty decrementado (1 -> 0).';

  SELECT status::text INTO v_prescription_status
    FROM "Prescription" WHERE id = '00000000-0000-0000-0000-000000024002';
  IF v_prescription_status <> 'SIGNED' THEN
    RAISE EXCEPTION 'FAIL 7) Prescription.status esperado SIGNED (recompute tras dispensedQty=0), fue %', v_prescription_status;
  END IF;
  RAISE NOTICE 'OK 7) Prescription.status recomputado (PARTIALLY_DISPENSED -> SIGNED).';

  RAISE NOTICE 'SMOKE 240: TODAS LAS ASERCIONES PASARON.';
END $$;

-- Nada de lo anterior persiste — fixtures y reversión quedan descartados
-- junto con la transacción.
ROLLBACK;
