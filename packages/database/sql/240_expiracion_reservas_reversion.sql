-- =====================================================================
-- 240_expiracion_reservas_reversion.sql
-- Auditoría 2026-09-15 (docs/audit/2026-09-15_cobertura/02-hc-farmacia-lab-
-- imagen.md, hallazgo C7 / B23 / P0-15) — el cron de expiración de reservas
-- de botiquín (`expire_pharmacy_reservations`, sql/89, pg_cron cada 5 min)
-- solo cambiaba `PharmacyReservation.status` a EXPIRED: NO reponía el stock
-- descontado en `reserveItem` ni revertía el cargo VIGENTE capturado en esa
-- misma operación — dejaba inventario y dinero huérfanos, invisibles en
-- conciliación (el reporte 5 solo miraba `status = 'CANCELLED'`, ver SQL 240
-- también en conciliacion-cargos.router.ts).
--
-- ⚠️ APLICADO a prod 2026-09-15 vía MCP (expiracion_reservas_reversion_240)
-- por @Orq — NO re-aplicar. Verificado: cron */5 activo, función con
-- reversión completa, 0 reservas vencidas pendientes al aplicar.
-- Requiere sql/89, sql/214 (Prescription
-- como pharmacy order) y sql/237 (PrescriptionItem.dispensedQty +
-- PharmacyReservation.prescriptionItemId) ya aplicados.
--
-- Reemplaza `public.expire_pharmacy_reservations()` (CREATE OR REPLACE,
-- mismo nombre/firma — no rompe el `SELECT public.expire_pharmacy_
-- reservations();` que ya invoca el job) y re-programa el mismo job pg_cron
-- (`his-expire-pharmacy-reservations`, cron.unschedule + cron.schedule,
-- mismo patrón idempotente que sql/89 y sql/238b).
--
-- ⚠️ PARIDAD — este SQL es un espejo deliberado de tres piezas TS en
-- packages/trpc/src/routers/pharmacy/dispensation.router.ts y
-- packages/trpc/src/lib/charge-capture.ts:
--   1. Reposición de stock: mismo patrón que `cancelReservation`
--      (dispensation.router.ts ~L1299-1334) — busca el StockMovement OUT con
--      referenceCode = reservation.id, incrementa StockLot.quantityOnHand,
--      crea el StockMovement IN espejo (razón EXPIRACION_RESERVA en vez de
--      "cancelación de reserva").
--   2. Reversión de cargo: mismo contrato que `revertirCargo`
--      (charge-capture.ts ~L269-319) — el cargo VIGENTE con
--      referenciaId = reservation.id se marca REVERTIDO (nunca se borra) y
--      se crea la línea REVERSION con quantity/totalPrice NEGATIVOS
--      enlazada por reversalOfId.
--   3. Decremento de dispensedQty + recompute de Prescription.status: mismo
--      contrato que `applyDispensedQtyDelta` (dispensation.router.ts
--      ~L421-472, CC-0030/SQL 237) — delta -1 con floor 0, status
--      DISPENSED/PARTIALLY_DISPENSED/SIGNED según el agregado de TODOS los
--      ítems de la receta, solo si la Prescription está en un estado del
--      ciclo de dispensación (nunca toca CANCELLED/EXPIRED).
-- Si CUALQUIERA de esas tres piezas TS cambia, este archivo debe cambiar en
-- el mismo PR — o el cron y el flujo interactivo divergen en silencio.
--
-- Idempotencia: el guard es el propio `status = 'RESERVED'` del cursor — una
-- vez procesada, la fila pasa a EXPIRED y no vuelve a calificar en la
-- siguiente corrida del cron (mismo principio que sql/89 original, sin
-- columna de guarda adicional — a diferencia de sql/238b, que sí necesita
-- guarda porque una CareTask puede cruzar el umbral de warning y exceeded
-- por separado; acá hay un solo umbral y una sola transición de estado).
--
-- "EN UNA TRANSACCIÓN por lote de trabajo": el cursor usa FOR UPDATE SKIP
-- LOCKED (mismo patrón que sql/238b) y la función completa corre como UNA
-- sola invocación de pg_cron = una sola transacción de Postgres — si una
-- reserva individual del lote fallara (excepción no capturada), todo el
-- lote de esa corrida se revierte y se reintenta en la corrida siguiente (no
-- hay pérdida de datos, solo un retraso de hasta 5 min); no se usa un
-- SAVEPOINT por fila porque ninguna de las 3 reversiones (stock/cargo/qty)
-- de una reserva contamina a las demás filas del lote.
--
-- Deliberadamente NO se reintroduce el INSERT a `public."NotificationOutbox"`
-- del sql/89 original: el propio hallazgo B24 de la misma auditoría confirma
-- que esa tabla (Beta.15) no tiene ningún consumidor — escribir ahí seguiría
-- siendo una fila muerta. Notificar la expiración/reversión por el canal
-- real (`DomainEvent` → outbox poller) queda como P1-17/P1-15 del informe de
-- auditoría, fuera del alcance de este fix (que es exclusivamente la
-- reversión de stock/cargo/qty, hallazgo C7/B23/P0-15).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.expire_pharmacy_reservations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row                 public."PharmacyReservation"%ROWTYPE;

  -- StockMovement OUT original (reposición de inventario, espejo cancelReservation).
  v_out_item_id          uuid;
  v_out_lot_id           uuid;
  v_out_quantity         numeric;
  v_out_establishment_id uuid;

  -- Cargo VIGENTE original (reversión, espejo revertirCargo). Tipos
  -- concretos (no %TYPE) — sin precedente de %TYPE en este repo, se prefiere
  -- el estilo ya usado en el resto de packages/database/sql.
  v_cargo_id             uuid;
  v_cargo_account_id     uuid;
  v_cargo_tipo           public."TipoServicio";
  v_cargo_encounter_id   uuid;
  v_cargo_code           varchar(40);
  v_cargo_quantity       numeric(12, 2);
  v_cargo_unit_price     numeric(12, 2);
  v_cargo_total_price    numeric(12, 2);
  v_cargo_price_list_id  uuid;
  v_cargo_price_rule_id  uuid;
  v_cargo_resolved_at    timestamptz;
  v_cargo_price_source   varchar(20);
  v_cargo_origen         varchar(30);
  v_cargo_referencia_id  uuid;

  -- PrescriptionItem/Prescription (recompute, espejo applyDispensedQtyDelta).
  v_item_dispensed_qty   numeric(12, 4);
  v_item_prescription_id uuid;
  v_next_qty             numeric(12, 4);
  v_all_done             boolean;
  v_any_dispensed        boolean;
  v_new_status           text;
  v_prescription_status  public."PrescriptionStatus";
BEGIN
  FOR v_row IN
    SELECT * FROM public."PharmacyReservation"
    WHERE status = 'RESERVED'
      AND "expiresAt" < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 1. Marcar EXPIRED.
    UPDATE public."PharmacyReservation"
    SET status = 'EXPIRED', "updatedAt" = now()
    WHERE id = v_row.id;

    -- 2. Reponer stock si la reserva descontó inventario (espejo
    --    cancelReservation dispensation.router.ts).
    SELECT "itemId", "lotId", quantity, "establishmentId"
      INTO v_out_item_id, v_out_lot_id, v_out_quantity, v_out_establishment_id
      FROM public."StockMovement"
      WHERE "organizationId" = v_row."organizationId"
        AND "referenceCode" = v_row.id::text
        AND type = 'OUT'
      LIMIT 1;

    IF v_out_lot_id IS NOT NULL THEN
      UPDATE public."StockLot"
      SET "quantityOnHand" = "quantityOnHand" + v_out_quantity,
          "updatedAt" = now()
      WHERE id = v_out_lot_id;

      INSERT INTO public."StockMovement" (
        id, "organizationId", "establishmentId", "itemId", "lotId", type,
        quantity, reason, "referenceCode", "gtin_fisico", "performedById",
        "performedAt", "createdAt"
      ) VALUES (
        gen_random_uuid(), v_row."organizationId", v_out_establishment_id,
        v_out_item_id, v_out_lot_id, 'IN', v_out_quantity,
        'Reposición por expiración de reserva (cron expire_pharmacy_reservations, EXPIRACION_RESERVA)',
        v_row.id::text, v_row.gtin, NULL, now(), now()
      );
    END IF;

    -- 3. Revertir el cargo VIGENTE asociado (espejo revertirCargo,
    --    charge-capture.ts) — a diferencia de returnItem, una reserva
    --    expirada sin cargo VIGENTE (ya revertido, o nunca se capturó) es un
    --    no-op silencioso, igual que cancelReservation: no hay usuario
    --    interactivo al que devolverle un error.
    SELECT id, "accountId", tipo, "encounterId", code, quantity, "unitPrice",
           "totalPrice", "priceListId", "priceRuleId", "resolvedAt",
           "priceSource", origen, "referenciaId"
      INTO v_cargo_id, v_cargo_account_id, v_cargo_tipo, v_cargo_encounter_id,
           v_cargo_code, v_cargo_quantity, v_cargo_unit_price,
           v_cargo_total_price, v_cargo_price_list_id, v_cargo_price_rule_id,
           v_cargo_resolved_at, v_cargo_price_source, v_cargo_origen,
           v_cargo_referencia_id
      FROM public."PatientAccountService"
      WHERE "referenciaId" = v_row.id
        AND status = 'VIGENTE'
      LIMIT 1;

    IF v_cargo_id IS NOT NULL THEN
      UPDATE public."PatientAccountService"
      SET status = 'REVERTIDO', "updatedAt" = now()
      WHERE id = v_cargo_id;

      INSERT INTO public."PatientAccountService" (
        id, "accountId", tipo, descripcion, "encounterId", code, quantity,
        "unitPrice", "totalPrice", "priceListId", "priceRuleId", "resolvedAt",
        "priceSource", status, "reversalOfId", origen, "referenciaId",
        "updatedAt", "createdAt", "createdBy"
      ) VALUES (
        gen_random_uuid(), v_cargo_account_id, v_cargo_tipo,
        'Reversión: Expiración automática de reserva (4h sin confirmar) [EXPIRACION_RESERVA]',
        v_cargo_encounter_id, v_cargo_code, -v_cargo_quantity,
        v_cargo_unit_price,
        CASE WHEN v_cargo_total_price IS NULL THEN NULL ELSE -v_cargo_total_price END,
        v_cargo_price_list_id, v_cargo_price_rule_id, v_cargo_resolved_at,
        v_cargo_price_source, 'REVERSION', v_cargo_id, v_cargo_origen,
        v_cargo_referencia_id, now(), now(), NULL
      );
    END IF;

    -- 4. Decrementar PrescriptionItem.dispensedQty -1 (floor 0) y recomputar
    --    Prescription.status (espejo applyDispensedQtyDelta, CC-0030/SQL
    --    237). Reservas legacy sin prescriptionItemId (0 filas en prod al
    --    aplicar SQL 237) se omiten — no hay a qué ítem atribuir el
    --    decremento, igual que cancelReservation/returnItem.
    IF v_row."prescriptionItemId" IS NOT NULL THEN
      SELECT "dispensedQty", "prescriptionId"
        INTO v_item_dispensed_qty, v_item_prescription_id
        FROM public."PrescriptionItem"
        WHERE id = v_row."prescriptionItemId"
        FOR UPDATE;

      IF FOUND THEN
        v_next_qty := GREATEST(0, v_item_dispensed_qty - 1);

        UPDATE public."PrescriptionItem"
        SET "dispensedQty" = v_next_qty
        WHERE id = v_row."prescriptionItemId";

        -- Recompute sobre TODOS los ítems de la receta (no solo el tocado)
        -- — una receta con varios medicamentos solo pasa a DISPENSED cuando
        -- TODOS quedan completos. Nota (paridad con el comentario TS): un
        -- ítem legacy con prescribedQty=0 nunca satisface "allDone" para esa
        -- receta — queda indefinidamente en PARTIALLY_DISPENSED, mismo
        -- comportamiento intencional que applyDispensedQtyDelta.
        SELECT
          bool_and("prescribedQty" > 0 AND "dispensedQty" >= "prescribedQty"),
          bool_or("dispensedQty" > 0)
          INTO v_all_done, v_any_dispensed
          FROM public."PrescriptionItem"
          WHERE "prescriptionId" = v_item_prescription_id;

        v_all_done := COALESCE(v_all_done, false);
        v_any_dispensed := COALESCE(v_any_dispensed, false);

        v_new_status := CASE
          WHEN v_all_done THEN 'DISPENSED'
          WHEN v_any_dispensed THEN 'PARTIALLY_DISPENSED'
          ELSE 'SIGNED'
        END;

        SELECT status INTO v_prescription_status
          FROM public."Prescription"
          WHERE id = v_item_prescription_id;

        IF v_prescription_status IN ('SIGNED', 'PARTIALLY_DISPENSED', 'DISPENSED')
           AND v_prescription_status::text <> v_new_status THEN
          UPDATE public."Prescription"
          SET status = v_new_status::"PrescriptionStatus", "updatedAt" = now()
          WHERE id = v_item_prescription_id;
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.expire_pharmacy_reservations() IS
  'SQL 240 (auditoría 2026-09-15, C7/B23) — expira reservas RESERVED vencidas '
  'Y revierte stock+cargo+dispensedQty, espejo de cancelReservation/'
  'revertirCargo/applyDispensedQtyDelta. Llamada por pg_cron cada 5 min. '
  'APLICADO 2026-09-15.';

-- -----------------------------------------------------------------------
-- Re-programar el job pg_cron — mismo jobname, mismo intervalo. Idempotente
-- (unschedule + schedule), mismo patrón que sql/89 y sql/238b.
-- -----------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('his-expire-pharmacy-reservations')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'his-expire-pharmacy-reservations'
    );
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron puede no estar disponible en CI
END$$;

SELECT cron.schedule(
  'his-expire-pharmacy-reservations',
  '*/5 * * * *',
  $$SELECT public.expire_pharmacy_reservations();$$
);
