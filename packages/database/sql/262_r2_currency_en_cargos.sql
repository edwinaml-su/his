-- =============================================================================
-- 262_r2_currency_en_cargos.sql — R2.3: moneda explícita en la línea de cargo
-- (Plan de remediación 2026-09, aprobado — auditoría multi-moneda 2026-09-18)
--
-- Hallazgo: "PatientAccountService" (la línea de cargo canónica) no tiene
-- "currencyId" — la moneda del cargo es implícita vía la lista de precios
-- ("ServicePriceList"."currencyId", sql/133) o, cuando no hay lista (fuente
-- "estandar"/catálogo, o PENDIENTE_TARIFA), no está registrada en ningún
-- lado. Con una sola organización operando en su propia moneda el bug es
-- invisible; en escenario multipaís/multimoneda la línea queda ambigua.
--
-- Columna NULLABLE (cero riesgo — no bloquea inserts existentes ni requiere
-- default en caliente). El write path (`capturarCargo`,
-- `crearCargoHonorarioYEnlazar`) la puebla desde este PR en adelante.
--
-- Backfill AUTOCONTENIDO e idempotente (regla del plan de remediación: una
-- migración no depende de una carga de datos externa posterior). Para las
-- filas existentes (currencyId IS NULL):
--   1. Si el cargo es trazable a una "ServicePriceList" (por "priceListId"
--      directo, y si no por "priceListId" de la "TipoCuenta" de su cuenta —
--      la resolución que habría usado `resolverPrecio` en su momento) ⇒ la
--      moneda de esa lista.
--   2. Si no es trazable ⇒ la moneda funcional de la "Organization" de su
--      cuenta (fallback documentado en el write path).
-- Idempotente: solo toca filas con "currencyId" IS NULL; correr dos veces no
-- cambia nada la segunda vez.
-- =============================================================================

-- 1. Columna ------------------------------------------------------------------
ALTER TABLE public."PatientAccountService"
  ADD COLUMN IF NOT EXISTS "currencyId" uuid REFERENCES public."Currency"(id);

COMMENT ON COLUMN public."PatientAccountService"."currencyId" IS
  'R2.3 (sql/262) — moneda EXPLÍCITA de unitPrice/totalPrice: la de la ServicePriceList que resolvió el precio, o la funcional de la org si no vino de una lista. Antes era implícita.';

-- 2. Backfill — paso 1: vía priceListId directo del cargo ---------------------
UPDATE public."PatientAccountService" pas
SET "currencyId" = spl."currencyId"
FROM public."ServicePriceList" spl
WHERE pas."currencyId" IS NULL
  AND pas."priceListId" IS NOT NULL
  AND spl.id = pas."priceListId";

-- 3. Backfill — paso 2: vía priceListId de la TipoCuenta de la cuenta del
--    cargo (cargos "estandar"/manuales que no guardaron priceListId propio
--    pero cuya cuenta sí tenía un tipo de cuenta con lista asignada).
UPDATE public."PatientAccountService" pas
SET "currencyId" = spl."currencyId"
FROM public."PatientAccount" pa
JOIN public."TipoCuenta" tc ON tc.id = pa."tipoCuentaId"
JOIN public."ServicePriceList" spl ON spl.id = tc."priceListId"
WHERE pas."currencyId" IS NULL
  AND pas."accountId" = pa.id;

-- 4. Backfill — paso 3: fallback a la moneda funcional de la organización de
--    la cuenta (cargos sin lista trazable — catálogo estándar, honorarios
--    médicos manuales, líneas PENDIENTE_TARIFA, o el stub sin precio de
--    `patientAccount.crear`/`agregarServicio`).
UPDATE public."PatientAccountService" pas
SET "currencyId" = org."functionalCurrency"
FROM public."PatientAccount" pa
JOIN public."Organization" org ON org.id = pa."organizationId"
WHERE pas."currencyId" IS NULL
  AND pas."accountId" = pa.id;

-- Verificación post-apply (para @Orq — NO se ejecuta como parte de esta
-- migración, es referencia manual):
--   SELECT count(*) FROM "PatientAccountService" WHERE "currencyId" IS NULL;
--   -- Esperado: 0 (toda fila tiene cuenta -> organización -> functionalCurrency,
--   -- así que el paso 3 cubre el 100% del remanente tras los pasos 1-2).
-- =============================================================================
