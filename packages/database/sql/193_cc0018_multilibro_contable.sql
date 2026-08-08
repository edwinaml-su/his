-- =============================================================================
-- 193_cc0018_multilibro_contable.sql
-- CC-0018 — Activación del multi-libro contable (cerrar drift + seed)
--
-- Hallazgo (verificación Edwin 2026-08-08): public."Ledger" existe pero con
-- 0 filas — el multi-libro nunca se activó. Al investigar se confirmó un
-- DRIFT preexistente de Beta.18 (PR #69, ADR 0007): `schema.prisma` declara
-- Account/AccountingPeriod/JournalEntry/JournalLine (líneas ~4416-4540) y el
-- router `packages/trpc/src/routers/accounting.router.ts` (chart/period/
-- journal/costCenter, con tests 23/23 verdes vía mocks) ya los consume, pero
-- las 4 tablas NUNCA se crearon físicamente en la BD (confirmado vía
-- mcp supabase list_tables — ausentes de public.*).
--
-- `packages/database/sql/47_accounting_hardening.sql` (también de PR #69) ya
-- existe y agrega RLS/audit-triggers/hash-chain/CHECK constraints/índices
-- parciales/grants sobre estas mismas 4 tablas + CostCenter — pero su propio
-- encabezado declara como PRECONDICIÓN que "el schema Prisma ya aplicó la
-- migración que crea las tablas". Esa migración nunca corrió contra prod
-- (este repo no usa `prisma migrate deploy` contra Supabase — flujo es
-- schema.prisma + sql/ numerados). Evidencia: la policy real de CostCenter
-- en prod es `cost_center_tenant` (de sql/128), NO `cost_center_tenant_isolation`
-- (la que definiría 47) — es decir, 47 jamás se ejecutó con éxito: su primer
-- ALTER TABLE ("Account" ENABLE RLS) habría abortado toda la transacción por
-- "relation does not exist" antes de llegar a la policy de CostCenter.
--
-- Alcance de ESTE archivo (193): SOLO lo que falta para que 47 pueda correr:
--   a) Enums faltantes: AccountType, PeriodStatus, JournalStatus, JournalOrigin
--      (LedgerKind YA existe físicamente — Ledger.kind lo usa hoy).
--   b) CREATE TABLE IF NOT EXISTS de las 4 tablas, espejo EXACTO de Prisma
--      (columnas/tipos/defaults/NOT NULL/uniques/índices/FKs con las
--      referential actions por defecto de Prisma: requerida→RESTRICT,
--      opcional→SET NULL, salvo onDelete explícito en el schema).
--   c) RLS mínima de arranque (ENABLE + policy) usando los MISMOS nombres de
--      policy que definirá 47 (`account_tenant_isolation`, etc.) — así, al
--      reaplicar 47 después, su propio `DROP POLICY IF EXISTS` + `CREATE
--      POLICY` reemplaza limpiamente sin dejar policies huérfanas. GRANT
--      SELECT/INSERT/UPDATE (sin DELETE — append-only) también espejea 47.
--   d) Seed: 2 libros por organización real (excluye 'RLS-Test%'):
--      FISCAL-SV (FISCAL_LOCAL) + IFRS (IFRS), moneda USD.
--
-- Deliberadamente FUERA de este archivo (ya cubierto por 47, no se duplica):
--   - Audit triggers (trg_*_audit), hash chain (chainPrevHash/chainHash),
--     CHECK constraints regulatorios (partida doble, fxRate>0, periodMonth),
--     trigger immutable POSTED, trigger período CLOSED, trigger cuenta hoja,
--     índices parciales operacionales, autovacuum tuning.
--   - Plan de cuentas (Account rows), asientos (JournalEntry/JournalLine),
--     apertura de períodos (AccountingPeriod rows) — eso lo captura
--     contabilidad vía UI/`accounting.router` (chart.create / period.create),
--     no un seed SQL.
--
-- ORDEN DE APLICACIÓN (@Orq):
--   1) Este archivo (193).
--   2) Reaplicar packages/database/sql/47_accounting_hardening.sql completo
--      (es idempotente: DO $$ guards, DROP POLICY IF EXISTS, CREATE OR
--      REPLACE). Sin este paso 2, las 4 tablas quedan SIN audit trail, SIN
--      hash chain y SIN los CHECK/trigger regulatorios de partida doble.
--   3) Verificar: SELECT count(*) FROM public."Ledger" (esperado: 2 × #orgs
--      reales); get_advisors(security) sin RLS-disabled en las 4 tablas.
--
-- Idempotente: reejecutable sin duplicar filas ni perder datos.
-- Aplicar vía: Supabase SQL Editor o MCP execute_sql / apply_migration.
-- Integración contable con Odoo: fuera de alcance (fase posterior — ver
-- docs/CC/0018/REQ-FIN-LIB-001-multilibro-contable.md §Fuera de alcance).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) Enums faltantes (LedgerKind ya existe — Ledger lo usa en prod hoy).
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "AccountType" AS ENUM (
    'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'STATISTICAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriodStatus" AS ENUM (
    'OPEN', 'PENDING_CLOSE', 'CLOSED', 'REOPENED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "JournalStatus" AS ENUM (
    'DRAFT', 'POSTED', 'REVERSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "JournalOrigin" AS ENUM (
    'MANUAL', 'SISTEMA_FACTURACION', 'SISTEMA_NOMINA', 'AJUSTE', 'CIERRE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- b) Tablas — espejo exacto de schema.prisma (líneas ~4416-4540).
-- -----------------------------------------------------------------------------

-- Account — plan de cuentas jerarquico por libro (ADR 0007 D3).
CREATE TABLE IF NOT EXISTS public."Account" (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"  uuid        NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "ledgerId"        uuid        NOT NULL REFERENCES public."Ledger"(id) ON DELETE RESTRICT,
  code              varchar(40)  NOT NULL,
  name              varchar(200) NOT NULL,
  "accountType"     "AccountType" NOT NULL,
  "isLeaf"          boolean     NOT NULL DEFAULT true,
  "allowPosting"    boolean     NOT NULL DEFAULT true,
  "parentAccountId" uuid        REFERENCES public."Account"(id) ON DELETE SET NULL,
  level             integer     NOT NULL DEFAULT 1,
  "currencyId"      uuid        NOT NULL REFERENCES public."Currency"(id) ON DELETE RESTRICT,
  active            boolean     NOT NULL DEFAULT true,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_account_ledger_code UNIQUE ("ledgerId", code)
);

CREATE INDEX IF NOT EXISTS idx_account_org_type    ON public."Account" ("organizationId", "accountType");
CREATE INDEX IF NOT EXISTS idx_account_ledger_parent ON public."Account" ("ledgerId", "parentAccountId");
CREATE INDEX IF NOT EXISTS idx_account_org_active  ON public."Account" ("organizationId", active);

-- AccountingPeriod — periodo fiscal por libro (ADR 0007 D6).
CREATE TABLE IF NOT EXISTS public."AccountingPeriod" (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid         NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "ledgerId"       uuid         NOT NULL REFERENCES public."Ledger"(id) ON DELETE RESTRICT,
  "periodYear"     integer      NOT NULL,
  "periodMonth"    integer      NOT NULL,
  "startDate"      date         NOT NULL,
  "endDate"        date         NOT NULL,
  status           "PeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closingNote"    varchar(500),
  "closedAt"       timestamptz,
  "closedById"     uuid         REFERENCES public."User"(id) ON DELETE SET NULL,
  "createdAt"      timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_accounting_period UNIQUE ("organizationId", "ledgerId", "periodYear", "periodMonth")
);

CREATE INDEX IF NOT EXISTS idx_accounting_period_org_ledger_status
  ON public."AccountingPeriod" ("organizationId", "ledgerId", status);

-- JournalEntry — cabecera de asiento contable, append-only (ADR 0007 D2).
CREATE TABLE IF NOT EXISTS public."JournalEntry" (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"    uuid          NOT NULL REFERENCES public."Organization"(id) ON DELETE RESTRICT,
  "ledgerId"          uuid          NOT NULL REFERENCES public."Ledger"(id) ON DELETE RESTRICT,
  "periodId"          uuid          NOT NULL REFERENCES public."AccountingPeriod"(id) ON DELETE RESTRICT,
  "entryDate"         date          NOT NULL,
  "numeroCorrelativo" integer       NOT NULL,
  referencia          varchar(120),
  descripcion         varchar(500)  NOT NULL,
  origen              "JournalOrigin" NOT NULL DEFAULT 'MANUAL',
  status              "JournalStatus" NOT NULL DEFAULT 'DRAFT',
  "currencyId"        uuid          NOT NULL REFERENCES public."Currency"(id) ON DELETE RESTRICT,
  "fxRate"            numeric(18,8),
  "fxRateDate"        date,
  "documentRef"       varchar(120),
  "documentType"      varchar(60),
  "postedAt"          timestamptz,
  "postedById"        uuid          REFERENCES public."User"(id) ON DELETE SET NULL,
  "createdById"       uuid          NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
  "reversalOfId"      uuid          REFERENCES public."JournalEntry"(id) ON DELETE SET NULL,
  "createdAt"         timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_journal_entry_correlativo
    UNIQUE ("organizationId", "ledgerId", "periodId", "numeroCorrelativo")
);

CREATE INDEX IF NOT EXISTS idx_journal_entry_org_ledger_date
  ON public."JournalEntry" ("organizationId", "ledgerId", "entryDate");
CREATE INDEX IF NOT EXISTS idx_journal_entry_org_period_status
  ON public."JournalEntry" ("organizationId", "periodId", status);
CREATE INDEX IF NOT EXISTS idx_journal_entry_doc
  ON public."JournalEntry" ("documentType", "documentRef");

-- JournalLine — linea de asiento (partida doble). Invariante debit/credit y
-- SUM(debit)=SUM(credit): trigger regulatorio en 47_accounting_hardening.sql.
CREATE TABLE IF NOT EXISTS public."JournalLine" (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "journalEntryId" uuid          NOT NULL REFERENCES public."JournalEntry"(id) ON DELETE RESTRICT,
  "lineNumber"     integer       NOT NULL,
  "accountId"      uuid          NOT NULL REFERENCES public."Account"(id) ON DELETE RESTRICT,
  debit            numeric(18,2) NOT NULL,
  credit           numeric(18,2) NOT NULL,
  descripcion      varchar(300),
  "costCenterId"   uuid          REFERENCES public."CostCenter"(id) ON DELETE SET NULL,
  "thirdPartyType" varchar(30),
  "thirdPartyId"   uuid,
  "createdAt"      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_journal_line_entry_number UNIQUE ("journalEntryId", "lineNumber")
);

CREATE INDEX IF NOT EXISTS idx_journal_line_entry       ON public."JournalLine" ("journalEntryId");
CREATE INDEX IF NOT EXISTS idx_journal_line_account     ON public."JournalLine" ("accountId");
CREATE INDEX IF NOT EXISTS idx_journal_line_cost_center ON public."JournalLine" ("costCenterId");

COMMENT ON TABLE public."Account" IS
  'CC-0018 — plan de cuentas jerarquico por libro (ADR 0007 D3). Hardening completo (audit/CHECK/triggers) en sql/47_accounting_hardening.sql.';
COMMENT ON TABLE public."AccountingPeriod" IS
  'CC-0018 — periodo fiscal por libro (ADR 0007 D6). Hardening completo en sql/47_accounting_hardening.sql.';
COMMENT ON TABLE public."JournalEntry" IS
  'CC-0018 — cabecera de asiento contable, append-only (ADR 0007 D2). Hash-chain + immutable-POSTED en sql/47_accounting_hardening.sql.';
COMMENT ON TABLE public."JournalLine" IS
  'CC-0018 — linea de asiento (partida doble). Trigger de balance SUM(debit)=SUM(credit) en sql/47_accounting_hardening.sql.';

-- -----------------------------------------------------------------------------
-- c) RLS de arranque — mismos nombres de policy que definirá 47 (reemplazo
--    limpio al reaplicar: DROP POLICY IF EXISTS + CREATE POLICY de 47).
-- -----------------------------------------------------------------------------

ALTER TABLE public."Account"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AccountingPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."JournalEntry"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."JournalLine"      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_tenant_isolation ON public."Account";
CREATE POLICY account_tenant_isolation ON public."Account"
  USING ("organizationId" = (current_setting('app.current_org_id', true))::uuid);

DROP POLICY IF EXISTS period_tenant_isolation ON public."AccountingPeriod";
CREATE POLICY period_tenant_isolation ON public."AccountingPeriod"
  USING ("organizationId" = (current_setting('app.current_org_id', true))::uuid);

DROP POLICY IF EXISTS journal_entry_tenant_isolation ON public."JournalEntry";
CREATE POLICY journal_entry_tenant_isolation ON public."JournalEntry"
  USING ("organizationId" = (current_setting('app.current_org_id', true))::uuid);

DROP POLICY IF EXISTS journal_line_tenant_isolation ON public."JournalLine";
CREATE POLICY journal_line_tenant_isolation ON public."JournalLine"
  USING (
    EXISTS (
      SELECT 1 FROM public."JournalEntry" je
      WHERE je.id = "journalEntryId"
        AND je."organizationId" = (current_setting('app.current_org_id', true))::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE ON public."Account"          TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."AccountingPeriod" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."JournalEntry"     TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."JournalLine"      TO authenticated;

-- -----------------------------------------------------------------------------
-- d) Seed — 2 libros por organización real (excluye orgs de prueba RLS).
--    FISCAL-SV usa kind=FISCAL_LOCAL (el enum no tiene valor 'FISCAL_SV'
--    literal); code sí es 'FISCAL-SV' para diferenciarlo del code que
--    ledger.router.ts deriva por defecto (code = kind) cuando un ADMIN cree
--    libros adicionales del mismo kind vía UI (ese flujo seguiría bloqueado
--    por el unique [orgId, code] + la regla de negocio "1 libro activo por
--    kind" del router — el seed no interfiere).
-- -----------------------------------------------------------------------------
INSERT INTO public."Ledger" (id, "organizationId", code, name, kind, "currencyId", active, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  o.id,
  v.code,
  v.name,
  v.kind::"LedgerKind",
  cur.id,
  true,
  now(),
  now()
FROM public."Organization" o
CROSS JOIN (VALUES
  ('FISCAL-SV', 'Libro Fiscal El Salvador', 'FISCAL_LOCAL'),
  ('IFRS',      'Libro IFRS Grupo',         'IFRS')
) AS v(code, name, kind)
CROSS JOIN (SELECT id FROM public."Currency" WHERE "isoCode" = 'USD' LIMIT 1) cur
WHERE o."legalName" NOT LIKE 'RLS-Test%'
  AND EXISTS (SELECT 1 FROM public."Currency" c WHERE c."isoCode" = 'USD')
  AND NOT EXISTS (
    SELECT 1 FROM public."Ledger" l
    WHERE l."organizationId" = o.id AND l.code = v.code
  );

-- -----------------------------------------------------------------------------
-- Verificación (ejecutar manualmente tras aplicar 193 + reaplicar 47):
-- -----------------------------------------------------------------------------
-- SELECT o."legalName", count(*) FROM public."Ledger" l
--   JOIN public."Organization" o ON o.id = l."organizationId"
--   GROUP BY o."legalName" ORDER BY 1;
-- -- Debe dar 2 libros (FISCAL-SV + IFRS) por cada org real.
--
-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('Account','AccountingPeriod','JournalEntry','JournalLine');
-- -- relrowsecurity debe ser 't' en las 4.
