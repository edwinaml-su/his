-- Nivel B Wave 4 — agrega FK opcional OperatingRoom.serviceUnitId.
--
-- Propósito: permitir filtrar SurgeryCase por el ServiceUnit del quirófano
-- donde se programa el caso (scope Nivel B). En la mayoría de instalaciones
-- todos los ORs pertenecen al servicio QX (Quirófano).
--
-- Backfill manual recomendado vía Supabase MCP después del apply:
--
--   UPDATE "OperatingRoom"
--   SET "serviceUnitId" = (
--     SELECT su.id
--     FROM "ServiceUnit" su
--     WHERE su.code = 'QX'
--       AND su."organizationId" = (
--         SELECT e."organizationId"
--         FROM "Establishment" e
--         WHERE e.id = "OperatingRoom"."establishmentId"
--       )
--     LIMIT 1
--   );
--
-- Verificar backfill:
--   SELECT id, code, "serviceUnitId" FROM "OperatingRoom" ORDER BY code;

ALTER TABLE "OperatingRoom"
  ADD COLUMN "serviceUnitId" uuid NULL
  REFERENCES "ServiceUnit"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "OperatingRoom_serviceUnitId_idx"
  ON "OperatingRoom"("serviceUnitId");
