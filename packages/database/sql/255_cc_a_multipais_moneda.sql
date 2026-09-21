-- ============================================================================
-- SQL 255 — CC-A: pre-requisitos multipaís/multimoneda (auditoría 2026-09-18)
-- ============================================================================
-- ⚠ APLICADO a prod (ejacvsgbewcerxtjtwto) el 2026-09-19 vía MCP — NO re-aplicar.
-- Verificado post-apply: documentType varchar + índice recreado + enum
-- eliminado; IVA SV 0.13 / GT 0.12; GTQ, CountryCurrency GT y DPI sembrados;
-- 128 pacientes intactos.
--
-- Contenido:
--   1) "Country"."vatRate" — IVA por país (antes 0.13 hardcodeado en
--      invoice.router.ts). Default 0.13 preserva el comportamiento actual
--      para orgs SV / sin país configurado.
--   2) Backfill explícito vatRate=0.13 para SV (documenta la decisión, aunque
--      el DEFAULT de la columna ya cubre el caso).
--   3) Currency GTQ (Quetzal guatemalteco) — idempotente.
--   4) Country GT (Guatemala) con vatRate=0.12 (12%) — idempotente.
--   5) CountryCurrency GT↔GTQ como funcional/legal — idempotente. Necesario
--      para que `resolverTasaFuncional`/`resolveCountryCurrency`
--      (packages/trpc/src/lib/exchange.ts, routers/triage.router.ts)
--      resuelvan una moneda funcional para orgs guatemaltecas.
--   6) IdentifierType DPI para GT — idempotente. Necesario para que
--      `patient.tiposDocumento` / `validarTipoDocumentoPorPais`
--      (packages/trpc/src/lib/document-type.ts) acepten el documento de
--      identidad guatemalteco (hallazgo P1 "paciente guatemalteco
--      capturable").
--
-- Precondición de schema: requiere que `Patient."documentType"` ya sea
-- VARCHAR (no el enum Postgres `DocumentType` de 5 valores fijos SV) — ver
-- bloque 0 más abajo. Sin este cambio, el paso 6 sería inútil: ningún valor
-- fuera de DUI/DNI/PASAPORTE/DUI_RESP/CARNET_RESIDENCIA podría persistirse
-- en Patient.documentType.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Patient.documentType: enum Postgres -> texto libre (CC-A P1).
--    Antes: enum "DocumentType" con 5 valores fijos SV. Ahora: VARCHAR(40),
--    validado en aplicación contra la lista legacy SV O contra
--    "IdentifierType".code activo del país de la organización (paridad con
--    packages/contracts/src/schemas/patient.ts + packages/trpc/src/lib/document-type.ts).
--
--    CORRECCIÓN (revisión independiente 2026-09-19): el comentario original
--    decía "es la ÚNICA columna que usaba el enum" — FALSO. El enum tiene un
--    segundo dependiente: el índice único parcial `uq_patient_documento_propio`
--    (sql/177_cc0002_documento_dedup.sql:32-34), cuyo predicado en prod es
--    `WHERE "documentType" = ANY (ARRAY['DUI','DNI','PASAPORTE']::"DocumentType"[])
--    AND "documentNumber" IS NOT NULL`. Sin dropear ese índice ANTES del
--    ALTER COLUMN, el ALTER falla en prod con 42883 (operador inexistente
--    contra varchar) y hace rollback total de este archivo. Se dropea el
--    índice, se hace el ALTER, se dropea el enum, y se recrea el índice con
--    el MISMO predicado pero literales text (ya no hay enum que castear).
--
--    Decisión v1 explícita (no silencio): los tipos de documento nuevos por
--    país (ej. DPI de Guatemala) quedan FUERA de este unique parcial — no se
--    amplía la lista de literales. Su deduplicación vive únicamente en el
--    check JS de `patient.router.ts#create` (`documentType !== "DUI_RESP"`),
--    que no es 1:1 a nivel BD. Si en el futuro se requiere dedup duro por BD
--    para tipos no-SV, hace falta un SQL aparte que decida el criterio
--    (¿todos los IdentifierType activos? ¿por país?) — no se resuelve aquí.
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_patient_documento_propio;

ALTER TABLE "Patient"
  ALTER COLUMN "documentType" TYPE varchar(40) USING "documentType"::text;

DROP TYPE IF EXISTS "DocumentType";

-- Mismo predicado que sql/177, ahora con literales text (sin enum que castear).
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_documento_propio
  ON "Patient" ("organizationId", "documentType", "documentNumber")
  WHERE "documentType" IN ('DUI', 'DNI', 'PASAPORTE') AND "documentNumber" IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 1) IVA por país.
-- ----------------------------------------------------------------------------
ALTER TABLE "Country"
  ADD COLUMN IF NOT EXISTS "vatRate" numeric(5,4) NOT NULL DEFAULT 0.13;

-- ----------------------------------------------------------------------------
-- 2) Backfill explícito SV (documenta la decisión; el DEFAULT ya cubre esto
--    para filas existentes y nuevas, pero se deja explícito por claridad).
-- ----------------------------------------------------------------------------
UPDATE "Country" SET "vatRate" = 0.13 WHERE "isoAlpha2" = 'SV';

-- ----------------------------------------------------------------------------
-- 3) Currency GTQ — idempotente (NOT EXISTS por isoCode único).
-- ----------------------------------------------------------------------------
INSERT INTO "Currency" (id, "isoCode", name, decimals, symbol, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'GTQ', 'Quetzal guatemalteco', 2, 'Q', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Currency" WHERE "isoCode" = 'GTQ');

-- ----------------------------------------------------------------------------
-- 4) Country GT (Guatemala) — idempotente (NOT EXISTS por isoAlpha3 único).
-- ----------------------------------------------------------------------------
INSERT INTO "Country" (
  id, "isoAlpha3", "isoAlpha2", "isoNumeric", name,
  "defaultLocale", "defaultTzId", active, "vatRate", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), 'GTM', 'GT', 320, 'Guatemala',
  'es-GT', 'America/Guatemala', true, 0.12, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Country" WHERE "isoAlpha3" = 'GTM');

-- ----------------------------------------------------------------------------
-- 5) CountryCurrency GT<->GTQ (funcional + legal tender) — idempotente
--    (PK compuesta countryId+currencyId ya da el ON CONFLICT natural).
-- ----------------------------------------------------------------------------
INSERT INTO "CountryCurrency" ("countryId", "currencyId", "isLegalTender", "isFunctional")
SELECT c.id, cur.id, true, true
FROM "Country" c, "Currency" cur
WHERE c."isoAlpha3" = 'GTM' AND cur."isoCode" = 'GTQ'
ON CONFLICT ("countryId", "currencyId") DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6) IdentifierType DPI para GT — idempotente (unique [countryId, code]).
--    `validatorFn` NULL: sin dígito verificador público documentado para el
--    DPI guatemalteco (CUI) al momento de este SQL — validación estructural
--    (no vacío) vía `validateIdentifier` default, igual que PASSPORT/MINOR_ID.
-- ----------------------------------------------------------------------------
INSERT INTO "IdentifierType" (id, "countryId", code, name, "validatorFn", active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), c.id, 'DPI', 'Documento Personal de Identificación', NULL, true, now(), now()
FROM "Country" c
WHERE c."isoAlpha3" = 'GTM'
ON CONFLICT ("countryId", code) DO NOTHING;
