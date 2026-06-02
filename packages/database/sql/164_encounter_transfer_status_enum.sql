-- 164_encounter_transfer_status_enum.sql
-- ---------------------------------------------------------------------------
-- Crea el enum public."EncounterTransferStatus" y convierte la columna
-- "EncounterTransfer"."status" (estaba como varchar) al enum.
--
-- Motivo: el schema.prisma declara `status EncounterTransferStatus @default(SENT)`,
-- pero el tipo enum nunca se creó en la BD. `prisma.encounterTransfer.create()`
-- castea el valor a ::"public"."EncounterTransferStatus" → ERROR 42704
-- ("type does not exist") en /transfers (Traslados internos).
--
-- Aplicado a prod vía MCP el 2026-06-02. Idempotente (seguro de re-ejecutar).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EncounterTransferStatus') THEN
    CREATE TYPE "public"."EncounterTransferStatus" AS ENUM ('SENT', 'RECEIVED', 'CANCELLED');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EncounterTransfer'
      AND column_name = 'status'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE "public"."EncounterTransfer" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "public"."EncounterTransfer"
      ALTER COLUMN "status" TYPE "public"."EncounterTransferStatus"
      USING "status"::"public"."EncounterTransferStatus";
    ALTER TABLE "public"."EncounterTransfer"
      ALTER COLUMN "status" SET DEFAULT 'SENT'::"public"."EncounterTransferStatus";
  END IF;
END $$;
