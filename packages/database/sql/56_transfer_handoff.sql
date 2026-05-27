-- 56_transfer_handoff.sql
-- Handoff interno de paciente: confirmación de recepción en destino.
--
-- Hoy `EncounterTransfer` registra el evento de traslado (origen, destino,
-- cama, motivo, quién y cuándo) pero NO captura que alguien en el servicio
-- destino confirmó la recepción. Esto deja huérfanos los siguientes flujos:
--   • Trazabilidad cama → SOP: piso origen no sabe si el paciente llegó.
--   • Cumplimiento JCI IPSG.2 (handoff comunicación).
--   • Gate quirúrgico: surgery.case.signIn requiere recepción explícita.
--
-- Estrategia: extender la tabla existente (regla "adecuar legacy, no
-- duplicar"). Migración idempotente: ADD COLUMN IF NOT EXISTS.
--
-- Estados:
--   SENT      ← default al crear el transfer (origen liberó cama)
--   RECEIVED  ← receptor confirma (transfer.confirmReceipt)
--   CANCELLED ← se canceló antes de la confirmación

ALTER TABLE "EncounterTransfer"
  ADD COLUMN IF NOT EXISTS "status"       VARCHAR(20) NOT NULL DEFAULT 'SENT',
  ADD COLUMN IF NOT EXISTS "receivedAt"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "receivedById" UUID REFERENCES "User"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "receivedNote" VARCHAR(400);

-- Enum check (idempotente: el constraint se recrea solo si no existe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EncounterTransfer_status_check'
  ) THEN
    ALTER TABLE "EncounterTransfer"
      ADD CONSTRAINT "EncounterTransfer_status_check"
      CHECK ("status" IN ('SENT', 'RECEIVED', 'CANCELLED'));
  END IF;
END $$;

-- Índices:
--   • Status global → bandejas por estado.
--   • (toServiceId, status) → "pendientes de recepción en el servicio X".
CREATE INDEX IF NOT EXISTS "EncounterTransfer_status_idx"
  ON "EncounterTransfer" ("status");

CREATE INDEX IF NOT EXISTS "EncounterTransfer_toService_status_idx"
  ON "EncounterTransfer" ("toServiceId", "status");

-- Backfill: registros históricos (antes de este sprint) se marcan como
-- RECEIVED para evitar romper queries de pacientes activos. No se conoce
-- el receptor real → receivedById queda NULL, receivedAt = occurredAt.
UPDATE "EncounterTransfer"
SET    "status"     = 'RECEIVED',
       "receivedAt" = "occurredAt"
WHERE  "status"     = 'SENT'
  AND  "occurredAt" < (now() - INTERVAL '1 hour');
