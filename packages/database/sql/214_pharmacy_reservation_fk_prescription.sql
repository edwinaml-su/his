-- =============================================================================
-- PR #581 — Consolidación dispensación farmacia | FK de PharmacyReservation
--
-- Hallazgo: "PharmacyReservation"."pharmacyOrderId" tenía FK a "PharmacyOrder"
-- (SQL 86), pero NINGÚN flujo de la aplicación crea filas en "PharmacyOrder".
-- La estación de despacho (/pharmacy/dispense/[orderId]) navega con ids de
-- "Prescription" — cada INSERT de reserva violaba la FK y el flujo de reserva
-- nunca pudo persistir en prod.
--
-- La semántica consolidada ya estaba documentada en dispensation.scanItem:
-- "la Prescription (receta firmada) actúa como pharmacy order". Este script
-- re-apunta la FK a "Prescription"("id").
--
-- Si existieran filas huérfanas que referencian "PharmacyOrder" (no debería:
-- solo el smoke test 208 inserta en esa tabla, y solo en BD efímera), el
-- ADD CONSTRAINT fallará ruidosamente — resolver a mano antes de reintentar.
--
-- Idempotente.
-- =============================================================================

DO $$
DECLARE
  v_target regclass;
BEGIN
  SELECT confrelid::regclass
    INTO v_target
    FROM pg_constraint
   WHERE conname = 'PharmacyReservation_pharmacyOrderId_fkey'
     AND conrelid = 'public."PharmacyReservation"'::regclass;

  IF v_target IS NOT NULL AND v_target::text = 'public."Prescription"' THEN
    RAISE NOTICE 'FK ya apunta a Prescription — nada que hacer.';
    RETURN;
  END IF;

  IF v_target IS NOT NULL THEN
    ALTER TABLE public."PharmacyReservation"
      DROP CONSTRAINT "PharmacyReservation_pharmacyOrderId_fkey";
  END IF;

  ALTER TABLE public."PharmacyReservation"
    ADD CONSTRAINT "PharmacyReservation_pharmacyOrderId_fkey"
    FOREIGN KEY ("pharmacyOrderId") REFERENCES public."Prescription"("id")
    ON DELETE RESTRICT;
END $$;

COMMENT ON COLUMN public."PharmacyReservation"."pharmacyOrderId"
  IS 'FK a Prescription — la receta firmada actúa como orden de farmacia (SQL 214, PR #581).';
