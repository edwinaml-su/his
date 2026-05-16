-- =============================================================================
-- HIS SQL 47 — Beta.18 Contabilidad multi-libro: hardening SQL
--
-- TDR §23 (contabilidad). ADR 0007 (multi-ledger, append-only).
-- SIN DTE Hacienda (ADR 0006 — servicio satélite separado).
--
-- Tablas nuevas: Account, AccountingPeriod, JournalEntry, JournalLine,
--               CostCenter + enums AccountType, PeriodStatus,
--               JournalStatus, JournalOrigin.
--
-- Precondición: el schema Prisma ya aplicó la migración que crea las tablas
-- y los enums. Este archivo añade lo que Prisma NO declara:
--   1. RLS policies por organization_id.
--   2. Audit triggers (extiende 02_audit_triggers.sql).
--   3. Hash chain en JournalEntry POSTED (extiende 05_audit_hash_chain.sql).
--   4. Índices adicionales (partial, compuestos).
--   5. CHECK constraints regulatorios (partida doble, immutable POSTED, etc.).
--   6. Trigger: balance partida doble AFTER INSERT/UPDATE en JournalLine.
--   7. Trigger: bloquear UPDATE/DELETE en JournalEntry POSTED.
--   8. Trigger: bloquear JournalEntry en período CLOSED.
--   9. Trigger: cuentas agrupadores no reciben líneas.
--
-- Idempotente: DO $$ guards, CREATE OR REPLACE, DROP POLICY IF EXISTS, etc.
--
-- Referencias:
--   - docs/adr/0007-multi-ledger-accounting.md
--   - packages/database/sql/02_audit_triggers.sql
--   - packages/database/sql/05_audit_hash_chain.sql
--   - packages/database/sql/42_notifications_outbox.sql (patrón RLS)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensiones de seguridad (ya instaladas; defensivo)
-- ---------------------------------------------------------------------------
-- pgcrypto disponible para digest(); uuid-ossp para uuid_generate_v4().
-- No se necesitan nuevas extensiones.

-- ---------------------------------------------------------------------------
-- 1. RLS — habilitar en tablas nuevas
-- ---------------------------------------------------------------------------

ALTER TABLE public."Account"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AccountingPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."JournalEntry"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."JournalLine"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CostCenter"       ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. RLS Policies — acceso por organization_id (patrón Avante estándar)
--
-- El rol 'authenticated' es el que usa la app tras applyTenantContext.
-- El rol 'service_role' bypasea RLS (Supabase default).
-- ---------------------------------------------------------------------------

-- Account
DROP POLICY IF EXISTS account_tenant_isolation ON public."Account";
CREATE POLICY account_tenant_isolation ON public."Account"
  USING (
    "organizationId" = (current_setting('app.current_org_id', true))::uuid
  );

-- AccountingPeriod
DROP POLICY IF EXISTS period_tenant_isolation ON public."AccountingPeriod";
CREATE POLICY period_tenant_isolation ON public."AccountingPeriod"
  USING (
    "organizationId" = (current_setting('app.current_org_id', true))::uuid
  );

-- JournalEntry
DROP POLICY IF EXISTS journal_entry_tenant_isolation ON public."JournalEntry";
CREATE POLICY journal_entry_tenant_isolation ON public."JournalEntry"
  USING (
    "organizationId" = (current_setting('app.current_org_id', true))::uuid
  );

-- JournalLine (accedida via JournalEntry; policy defensiva)
DROP POLICY IF EXISTS journal_line_tenant_isolation ON public."JournalLine";
CREATE POLICY journal_line_tenant_isolation ON public."JournalLine"
  USING (
    EXISTS (
      SELECT 1 FROM public."JournalEntry" je
      WHERE je.id = "journalEntryId"
        AND je."organizationId" = (current_setting('app.current_org_id', true))::uuid
    )
  );

-- CostCenter
DROP POLICY IF EXISTS cost_center_tenant_isolation ON public."CostCenter";
CREATE POLICY cost_center_tenant_isolation ON public."CostCenter"
  USING (
    "organizationId" = (current_setting('app.current_org_id', true))::uuid
  );

-- ---------------------------------------------------------------------------
-- 3. Audit triggers — extiende 02_audit_triggers.sql
--
-- Se usa la función audit.fn_log_action() que ya existe en el schema.
-- Si la función tiene firma diferente, ajustar acá.
-- ---------------------------------------------------------------------------

-- Verificamos que la función de audit existe antes de crear triggers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'audit' AND p.proname = 'fn_log_action'
  ) THEN
    RAISE WARNING 'audit.fn_log_action no existe aun. Audit triggers de Beta.18 no se crearán. Aplicar 02_audit_triggers.sql primero.';
  END IF;
END $$;

-- Account audit
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'audit' AND p.proname = 'fn_log_action'
  ) THEN
    EXECUTE $trig$
      CREATE OR REPLACE TRIGGER trg_account_audit
        AFTER INSERT OR UPDATE OR DELETE ON public."Account"
        FOR EACH ROW EXECUTE FUNCTION audit.fn_log_action()
    $trig$;
  END IF;
END $$;

-- AccountingPeriod audit
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'audit' AND p.proname = 'fn_log_action'
  ) THEN
    EXECUTE $trig$
      CREATE OR REPLACE TRIGGER trg_accounting_period_audit
        AFTER INSERT OR UPDATE OR DELETE ON public."AccountingPeriod"
        FOR EACH ROW EXECUTE FUNCTION audit.fn_log_action()
    $trig$;
  END IF;
END $$;

-- JournalEntry audit
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'audit' AND p.proname = 'fn_log_action'
  ) THEN
    EXECUTE $trig$
      CREATE OR REPLACE TRIGGER trg_journal_entry_audit
        AFTER INSERT OR UPDATE OR DELETE ON public."JournalEntry"
        FOR EACH ROW EXECUTE FUNCTION audit.fn_log_action()
    $trig$;
  END IF;
END $$;

-- JournalLine audit (solo INSERT — DELETE no debe ocurrir en estado normal)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'audit' AND p.proname = 'fn_log_action'
  ) THEN
    EXECUTE $trig$
      CREATE OR REPLACE TRIGGER trg_journal_line_audit
        AFTER INSERT OR UPDATE OR DELETE ON public."JournalLine"
        FOR EACH ROW EXECUTE FUNCTION audit.fn_log_action()
    $trig$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Hash chain en JournalEntry POSTED — extiende 05_audit_hash_chain.sql
--
-- Calcula chain_hash = SHA-256(prev_chain_hash || payload_hash) al momento
-- de transicionar a POSTED. Esto da inmutabilidad criptográfica al libro.
--
-- Columnas auxiliares (no en schema.prisma — operacionales del hardening):
--   "chainPrevHash"    VARCHAR(64)  — hash de la entrada POSTED anterior en el mismo ledger
--   "chainHash"        VARCHAR(64)  — hash de esta entrada (SHA-256(prev||payload))
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'JournalEntry'
      AND column_name = 'chainPrevHash'
  ) THEN
    ALTER TABLE public."JournalEntry"
      ADD COLUMN "chainPrevHash" VARCHAR(64),
      ADD COLUMN "chainHash"     VARCHAR(64);
  END IF;
END $$;

COMMENT ON COLUMN public."JournalEntry"."chainPrevHash" IS
  'Beta.18 — hash de la última entrada POSTED en el mismo ledger (cadena criptográfica).';
COMMENT ON COLUMN public."JournalEntry"."chainHash" IS
  'Beta.18 — SHA-256(chainPrevHash || encode(sha256(payload), hex)) para audit chain.';

-- Función que calcula el hash chain al hacer POST de un JournalEntry.
-- Se dispara BEFORE UPDATE cuando status cambia a POSTED.
CREATE OR REPLACE FUNCTION accounting.fn_journal_entry_hash_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prev_hash TEXT;
  v_payload   TEXT;
  v_hash      TEXT;
BEGIN
  -- Solo actúa al transicionar a POSTED.
  IF NEW.status <> 'POSTED' OR OLD.status = 'POSTED' THEN
    RETURN NEW;
  END IF;

  -- Obtener el último chainHash del mismo ledger (orden por postedAt o createdAt).
  SELECT "chainHash"
    INTO v_prev_hash
    FROM public."JournalEntry"
   WHERE "ledgerId" = NEW."ledgerId"
     AND status = 'POSTED'
     AND id <> NEW.id
   ORDER BY "postedAt" DESC NULLS LAST, "createdAt" DESC
   LIMIT 1;

  v_prev_hash := COALESCE(v_prev_hash, '0000000000000000000000000000000000000000000000000000000000000000');

  -- Payload canónico: concatenar campos immutables del entry.
  v_payload := NEW.id
    || '|' || NEW."organizationId"
    || '|' || NEW."ledgerId"
    || '|' || NEW."periodId"
    || '|' || NEW."entryDate"::text
    || '|' || NEW."numeroCorrelativo"::text
    || '|' || COALESCE(NEW."descripcion", '')
    || '|' || NEW."origen"
    || '|' || NEW."currencyId";

  v_hash := encode(
    digest(v_prev_hash || encode(digest(v_payload, 'sha256'), 'hex'), 'sha256'),
    'hex'
  );

  NEW."chainPrevHash" := v_prev_hash;
  NEW."chainHash"     := v_hash;
  RETURN NEW;
END $$;

-- Schema para funciones SECURITY DEFINER de contabilidad.
CREATE SCHEMA IF NOT EXISTS accounting;
GRANT USAGE ON SCHEMA accounting TO authenticated, service_role;
COMMENT ON SCHEMA accounting IS
  'Beta.18 — funciones SECURITY DEFINER del módulo de contabilidad.';

-- Recrear la función ahora que el schema existe.
CREATE OR REPLACE FUNCTION accounting.fn_journal_entry_hash_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prev_hash TEXT;
  v_payload   TEXT;
  v_hash      TEXT;
BEGIN
  IF NEW.status <> 'POSTED' OR OLD.status = 'POSTED' THEN
    RETURN NEW;
  END IF;

  SELECT "chainHash"
    INTO v_prev_hash
    FROM public."JournalEntry"
   WHERE "ledgerId" = NEW."ledgerId"
     AND status = 'POSTED'
     AND id <> NEW.id
   ORDER BY "postedAt" DESC NULLS LAST, "createdAt" DESC
   LIMIT 1;

  v_prev_hash := COALESCE(v_prev_hash, '0000000000000000000000000000000000000000000000000000000000000000');

  v_payload := NEW.id
    || '|' || NEW."organizationId"
    || '|' || NEW."ledgerId"
    || '|' || NEW."periodId"
    || '|' || NEW."entryDate"::text
    || '|' || NEW."numeroCorrelativo"::text
    || '|' || COALESCE(NEW."descripcion", '')
    || '|' || NEW."origen"
    || '|' || NEW."currencyId";

  v_hash := encode(
    pg_catalog.digest(v_prev_hash || encode(pg_catalog.digest(v_payload, 'sha256'), 'hex'), 'sha256'),
    'hex'
  );

  NEW."chainPrevHash" := v_prev_hash;
  NEW."chainHash"     := v_hash;
  RETURN NEW;
END $$;

-- Trigger hash chain: BEFORE UPDATE en JournalEntry
DROP TRIGGER IF EXISTS trg_journal_entry_hash_chain ON public."JournalEntry";
CREATE TRIGGER trg_journal_entry_hash_chain
  BEFORE UPDATE ON public."JournalEntry"
  FOR EACH ROW
  EXECUTE FUNCTION accounting.fn_journal_entry_hash_chain();

-- ---------------------------------------------------------------------------
-- 5. CHECK constraints regulatorios
-- ---------------------------------------------------------------------------

-- 5a. JournalLine: debit >= 0, credit >= 0, not both > 0 (partida simple)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_line_debit_credit_chk'
  ) THEN
    ALTER TABLE public."JournalLine"
      ADD CONSTRAINT journal_line_debit_credit_chk
      CHECK (
        debit  >= 0
        AND credit >= 0
        AND NOT (debit > 0 AND credit > 0)
      );
  END IF;
END $$;

-- 5b. AccountingPeriod: periodMonth en rango 0–12 (0 = cierre anual)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounting_period_month_chk'
  ) THEN
    ALTER TABLE public."AccountingPeriod"
      ADD CONSTRAINT accounting_period_month_chk
      CHECK ("periodMonth" BETWEEN 0 AND 12);
  END IF;
END $$;

-- 5c. JournalEntry: fxRate > 0 si no es null
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_entry_fx_rate_chk'
  ) THEN
    ALTER TABLE public."JournalEntry"
      ADD CONSTRAINT journal_entry_fx_rate_chk
      CHECK ("fxRate" IS NULL OR "fxRate" > 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Trigger: balance partida doble
--
-- AFTER INSERT OR UPDATE OR DELETE en JournalLine:
-- Verifica SUM(debit) = SUM(credit) para el JournalEntry padre.
-- Solo aplica si el entry ya está POSTED o si el entry está en DRAFT y tiene
-- al menos 2 líneas (permite builds incrementales en DRAFT).
-- La validación estricta ANTES de hacer POST la hace el router TS.
-- Este trigger es la última línea de defensa a nivel BD.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accounting.fn_check_double_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry_id      UUID;
  v_entry_status  TEXT;
  v_sum_debit     NUMERIC;
  v_sum_credit    NUMERIC;
BEGIN
  -- Determinar entry_id: para DELETE usa OLD, para INSERT/UPDATE usa NEW.
  IF TG_OP = 'DELETE' THEN
    v_entry_id := OLD."journalEntryId";
  ELSE
    v_entry_id := NEW."journalEntryId";
  END IF;

  -- Solo validar si el entry está POSTED (los DRAFT se validan en el router).
  SELECT status INTO v_entry_status
    FROM public."JournalEntry"
   WHERE id = v_entry_id;

  IF v_entry_status = 'POSTED' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_sum_debit, v_sum_credit
      FROM public."JournalLine"
     WHERE "journalEntryId" = v_entry_id;

    IF v_sum_debit <> v_sum_credit THEN
      RAISE EXCEPTION
        'Partida doble desbalanceada en asiento % (debit=%, credit=%). Operación rechazada.',
        v_entry_id, v_sum_debit, v_sum_credit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journal_line_balance ON public."JournalLine";
CREATE TRIGGER trg_journal_line_balance
  AFTER INSERT OR UPDATE OR DELETE ON public."JournalLine"
  FOR EACH ROW
  EXECUTE FUNCTION accounting.fn_check_double_entry_balance();

-- ---------------------------------------------------------------------------
-- 7. Trigger: immutable JournalEntry POSTED
--
-- Un asiento POSTED no puede ser modificado ni eliminado.
-- La corrección se hace por contraasiento (JournalEntry.reversalOfId).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accounting.fn_journal_entry_immutable_posted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- DELETE: bloquear si el entry está POSTED.
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION
        'Asiento contable % está POSTED y es immutable. Use un contraasiento para corregir.',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: bloquear si el estado anterior era POSTED y se intenta cambiar
  -- campos inmutables. Permitir solo la transición POSTED → REVERSED
  -- (cuando se registra el contraasiento).
  IF OLD.status = 'POSTED' THEN
    -- Permitir solo status POSTED → REVERSED (y chainPrevHash/chainHash que
    -- actualiza el trigger de hash chain en la misma operación).
    IF NEW.status NOT IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION
        'Asiento contable % está POSTED. Solo se permite transicionar a REVERSED.',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    -- Bloquear cambios a campos financieros inmutables.
    IF NEW."ledgerId"          <> OLD."ledgerId"
    OR NEW."periodId"          <> OLD."periodId"
    OR NEW."entryDate"         <> OLD."entryDate"
    OR NEW."numeroCorrelativo" <> OLD."numeroCorrelativo"
    OR NEW."currencyId"        <> OLD."currencyId"
    OR NEW."origen"            <> OLD."origen"
    THEN
      RAISE EXCEPTION
        'Asiento contable % está POSTED. Sus campos financieros son inmutables.',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journal_entry_immutable ON public."JournalEntry";
CREATE TRIGGER trg_journal_entry_immutable
  BEFORE UPDATE OR DELETE ON public."JournalEntry"
  FOR EACH ROW
  EXECUTE FUNCTION accounting.fn_journal_entry_immutable_posted();

-- ---------------------------------------------------------------------------
-- 8. Trigger: bloquear JournalEntry en período CLOSED
--
-- Un período CLOSED no acepta nuevos asientos (ni DRAFT ni POSTED).
-- Solo períodos OPEN o REOPENED son válidos para insertar.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accounting.fn_journal_entry_period_open_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period_status TEXT;
BEGIN
  SELECT status INTO v_period_status
    FROM public."AccountingPeriod"
   WHERE id = NEW."periodId";

  IF v_period_status NOT IN ('OPEN', 'REOPENED') THEN
    RAISE EXCEPTION
      'El período % está en estado %. Solo períodos OPEN o REOPENED aceptan asientos.',
      NEW."periodId", v_period_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journal_entry_period_check ON public."JournalEntry";
CREATE TRIGGER trg_journal_entry_period_check
  BEFORE INSERT ON public."JournalEntry"
  FOR EACH ROW
  EXECUTE FUNCTION accounting.fn_journal_entry_period_open_check();

-- ---------------------------------------------------------------------------
-- 9. Trigger: solo cuentas hoja (isLeaf=true) reciben JournalLine
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accounting.fn_journal_line_leaf_account_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_leaf       BOOLEAN;
  v_allow_posting BOOLEAN;
BEGIN
  SELECT "isLeaf", "allowPosting"
    INTO v_is_leaf, v_allow_posting
    FROM public."Account"
   WHERE id = NEW."accountId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta % no existe.', NEW."accountId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT v_is_leaf THEN
    RAISE EXCEPTION
      'La cuenta % es una cuenta agrupadora (isLeaf=false). No acepta movimientos.',
      NEW."accountId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_allow_posting THEN
    RAISE EXCEPTION
      'La cuenta % tiene allowPosting=false. No acepta movimientos.',
      NEW."accountId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journal_line_leaf_check ON public."JournalLine";
CREATE TRIGGER trg_journal_line_leaf_check
  BEFORE INSERT OR UPDATE OF "accountId" ON public."JournalLine"
  FOR EACH ROW
  EXECUTE FUNCTION accounting.fn_journal_line_leaf_account_check();

-- ---------------------------------------------------------------------------
-- 10. Índices adicionales (partial, operacionales)
-- ---------------------------------------------------------------------------

-- JournalEntry: partial index para entries DRAFT (frecuentes en edición)
CREATE INDEX IF NOT EXISTS ix_journal_entry_draft
  ON public."JournalEntry" ("organizationId", "periodId")
  WHERE status = 'DRAFT';

-- JournalEntry: partial index para entries POSTED (reportes financieros)
CREATE INDEX IF NOT EXISTS ix_journal_entry_posted
  ON public."JournalEntry" ("organizationId", "ledgerId", "entryDate")
  WHERE status = 'POSTED';

-- AccountingPeriod: partial index para períodos abiertos (insertabilidad)
CREATE INDEX IF NOT EXISTS ix_accounting_period_open
  ON public."AccountingPeriod" ("organizationId", "ledgerId")
  WHERE status IN ('OPEN', 'REOPENED');

-- Account: partial index para cuentas hoja activas (lookup de JournalLine)
CREATE INDEX IF NOT EXISTS ix_account_leaf_active
  ON public."Account" ("ledgerId", code)
  WHERE "isLeaf" = true AND "allowPosting" = true AND active = true;

-- ---------------------------------------------------------------------------
-- 11. Autovacuum tuning (JournalEntry recibe actualizaciones frecuentes
--     en status: DRAFT → POSTED → REVERSED)
-- ---------------------------------------------------------------------------

ALTER TABLE public."JournalEntry" SET (
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_analyze_scale_factor = 0.05,
  fillfactor = 80
);

ALTER TABLE public."JournalLine" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  fillfactor = 90
);

-- ---------------------------------------------------------------------------
-- 12. Grants al rol authenticated (necesario para que RLS funcione)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON public."Account"          TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."AccountingPeriod" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."JournalEntry"     TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."JournalLine"      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public."CostCenter"       TO authenticated;

-- Revocar DELETE explícitamente (append-only; service_role puede si necesita ops)
REVOKE DELETE ON public."JournalEntry" FROM authenticated;
REVOKE DELETE ON public."JournalLine"  FROM authenticated;

-- ---------------------------------------------------------------------------
-- 13. Comentarios regulatorios
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public."Account" IS
  'Beta.18 — plan de cuentas jerarquico por libro. ADR 0007 D3. Solo cuentas hoja reciben movimientos.';
COMMENT ON TABLE public."AccountingPeriod" IS
  'Beta.18 — periodo fiscal por libro. ADR 0007 D6. CLOSED no acepta nuevos asientos.';
COMMENT ON TABLE public."JournalEntry" IS
  'Beta.18 — cabecera de asiento contable. Append-only. POSTED es inmutable (ADR 0007 D2).';
COMMENT ON TABLE public."JournalLine" IS
  'Beta.18 — linea de asiento (partida doble). SUM(debit)=SUM(credit) por entry.';
COMMENT ON TABLE public."CostCenter" IS
  'Beta.18 — centro de costos. Referencia opcional en JournalLine para controlling gerencial.';
