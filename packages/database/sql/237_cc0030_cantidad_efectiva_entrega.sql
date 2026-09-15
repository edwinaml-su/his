-- =============================================================================
-- 237_cc0030_cantidad_efectiva_entrega.sql
-- CC-0030 — R6 de RN-HIS-BOT-001 (docs/47 §4): "Se carga la cantidad
-- ENTREGADA, no la solicitada. La entrega parcial genera cargo parcial y
-- deja el pendiente visible."
--
-- Verificado vía MCP execute_sql (2026-09-15, proyecto ejacvsgbewcerxtjtwto)
-- antes de escribir este archivo:
--   SELECT count(*) FROM "PharmacyReservation"                  → 0
--   SELECT count(*) FROM "PrescriptionItem"                     → 0
--   SELECT count(*) FROM "PrescriptionItem" WHERE "prescribedQty" > 0 → 0
-- Ambas tablas están vacías en prod — no hay backfill de datos que hacer ni
-- riesgo de qty inconsistente al agregar las columnas con DEFAULT 0.
--
-- a) "PrescriptionItem"."dispensedQty" — qty NETA entregada por farmacia
--    (reservas/scans vivos, no CANCELLED/RETURNED). Mantenida por la APP
--    (dispensation.router.ts), NO por trigger — a diferencia de
--    "administeredQty" (trigger SQL 32_emar_hardening.sql): el neteo de
--    reserveItem/returnItem/cancelReservation vive junto a la captura/
--    reversión del cargo (capturarCargo/revertirCargo), en la MISMA
--    transacción — un trigger reimplementaría esa lógica en SQL sin ganar
--    nada y complicaría el rollback atómico que ya existe en TS.
--
-- b) "PharmacyReservation"."prescriptionItemId" — enlace explícito FK a
--    PrescriptionItem. Hallazgo: la reserva NUNCA tuvo este enlace directo —
--    `reserveItem`/`returnItem` resuelven el fármaco tomando "el primer ítem
--    de la receta" (`prescription.items[0]`, limitación documentada
--    docs/48 Ola 4b H-13, pendiente Drug.gtin para matchear exacto). Con 0
--    filas en prod no hay backfill posible ni necesario — la columna nace
--    NULL y `reserveItem` la setea desde este cambio en adelante;
--    `returnItem`/`cancelReservation` la leen para decrementar
--    `dispensedQty` del ítem EXACTO que la reserva entregó, en vez de
--    volver a adivinar "el primer ítem". Reservas legacy (ninguna en prod)
--    quedarían con prescriptionItemId NULL — el decremento se omite para
--    ellas (no hay a qué ítem atribuirlo), documentado en el router.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + FK/índice guardados con DO $$.
-- APLICADO a prod 2026-09-15 vía MCP (proyecto ejacvsgbewcerxtjtwto) — NO
-- re-aplicar.
-- =============================================================================

ALTER TABLE public."PrescriptionItem"
  ADD COLUMN IF NOT EXISTS "dispensedQty" numeric(12, 4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public."PrescriptionItem"."dispensedQty" IS
  'CC-0030 (RN-HIS-BOT-001 R6) — qty neta entregada por farmacia (reservas/scans vivos). Mantenida por la app, no por trigger (SQL 237).';

ALTER TABLE public."PharmacyReservation"
  ADD COLUMN IF NOT EXISTS "prescriptionItemId" uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'PharmacyReservation_prescriptionItemId_fkey'
       AND conrelid = 'public."PharmacyReservation"'::regclass
  ) THEN
    ALTER TABLE public."PharmacyReservation"
      ADD CONSTRAINT "PharmacyReservation_prescriptionItemId_fkey"
      FOREIGN KEY ("prescriptionItemId") REFERENCES public."PrescriptionItem"("id")
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PharmacyReservation_prescriptionItemId_idx"
  ON public."PharmacyReservation" ("prescriptionItemId");

COMMENT ON COLUMN public."PharmacyReservation"."prescriptionItemId" IS
  'CC-0030 (RN-HIS-BOT-001 R6) — FK al PrescriptionItem que esta reserva entrega. NULL en reservas legacy (0 filas en prod al aplicar SQL 237). Seteado por dispensation.router.ts reserveItem.';
