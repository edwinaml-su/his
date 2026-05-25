-- =============================================================================
-- 127_finance_invoice_claim.sql
-- Módulo Finance MVP — Invoice, InvoiceItem, Claim, Payment
-- Wave 3 KPI dashboard: habilita los 6 KPIs financieros con datos reales.
--
-- Modelo mínimo para soportar los KPIs sin pretender módulo Finance completo:
--   - fin_costo_egreso          (sumatoria items / nº encounters)
--   - fin_dso                   (CxC / revenue × días)
--   - fin_rechazo_reclamaciones (% claims rechazados)
--   - fin_factura_electronica   (% facturas e-MH aceptadas)
--   - fin_margen                (ingresos − costos / ingresos)
--   - fin_costo_his             (mock - no se calcula con esta tabla)
--
-- NO incluye: workflow de aprobación, integración real con MH (e-factura),
-- conciliación bancaria, cierres contables. Esos son sprints dedicados.
-- =============================================================================

-- ─── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM (
    'DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'VOIDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE electronic_invoice_status AS ENUM (
    'NOT_APPLICABLE', 'PENDING', 'ACCEPTED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM (
    'CASH', 'CARD', 'TRANSFER', 'INSURANCE', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE claim_status AS ENUM (
    'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PARTIALLY_APPROVED', 'PAID'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Invoice ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Invoice" (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"            uuid NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT,
  "establishmentId"           uuid NOT NULL REFERENCES "Establishment"(id) ON DELETE RESTRICT,
  "encounterId"               uuid REFERENCES "Encounter"(id) ON DELETE SET NULL,
  "patientId"                 uuid NOT NULL REFERENCES "Patient"(id) ON DELETE RESTRICT,
  "insurerId"                 uuid REFERENCES "Insurer"(id) ON DELETE SET NULL,
  "invoiceNumber"             varchar(40) NOT NULL,
  "issuedAt"                  timestamptz NOT NULL DEFAULT now(),
  "dueAt"                     timestamptz,
  "currencyId"                uuid NOT NULL REFERENCES "Currency"(id) ON DELETE RESTRICT,
  "exchangeRateToFunc"        numeric(18,8) NOT NULL DEFAULT 1,
  subtotal                    numeric(14,2) NOT NULL DEFAULT 0,
  "taxAmount"                 numeric(14,2) NOT NULL DEFAULT 0,
  "totalAmount"               numeric(14,2) NOT NULL DEFAULT 0,
  "paidAmount"                numeric(14,2) NOT NULL DEFAULT 0,
  status                      invoice_status NOT NULL DEFAULT 'DRAFT',
  "electronicInvoiceStatus"   electronic_invoice_status NOT NULL DEFAULT 'NOT_APPLICABLE',
  "electronicInvoiceCode"     varchar(64),
  "electronicInvoiceIssuedAt" timestamptz,
  notes                       text,
  "createdAt"                 timestamptz NOT NULL DEFAULT now(),
  "createdBy"                 uuid,
  "updatedAt"                 timestamptz NOT NULL DEFAULT now(),
  "updatedBy"                 uuid,
  UNIQUE ("organizationId", "invoiceNumber"),
  CONSTRAINT invoice_amounts_chk CHECK ("totalAmount" >= 0 AND "paidAmount" >= 0 AND "paidAmount" <= "totalAmount")
);

CREATE INDEX IF NOT EXISTS idx_invoice_org_issued    ON "Invoice" ("organizationId", "issuedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_patient       ON "Invoice" ("patientId");
CREATE INDEX IF NOT EXISTS idx_invoice_encounter     ON "Invoice" ("encounterId") WHERE "encounterId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_status        ON "Invoice" ("organizationId", status);
CREATE INDEX IF NOT EXISTS idx_invoice_einv_status   ON "Invoice" ("organizationId", "electronicInvoiceStatus");

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_tenant_isolation ON "Invoice";
CREATE POLICY invoice_tenant_isolation ON "Invoice"
  FOR ALL TO authenticated
  USING ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid);

-- ─── InvoiceItem ────────────────────────────────────────────────────────────
-- NOTA: costCenterId es OBLIGATORIO (ver 128_cost_center_table_and_invoice_fk.sql).
-- Sin centro de costo no es posible análisis presupuestario / margen por área.
CREATE TABLE IF NOT EXISTS "InvoiceItem" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoiceId"     uuid NOT NULL REFERENCES "Invoice"(id) ON DELETE CASCADE,
  description     varchar(300) NOT NULL,
  quantity        numeric(12,3) NOT NULL DEFAULT 1,
  "unitPrice"     numeric(14,2) NOT NULL DEFAULT 0,
  "totalPrice"    numeric(14,2) NOT NULL DEFAULT 0,
  "serviceUnitId" uuid REFERENCES "ServiceUnit"(id) ON DELETE SET NULL,
  "costCenterId"  uuid NOT NULL REFERENCES "CostCenter"(id) ON DELETE RESTRICT,
  "estimatedCost" numeric(14,2),
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_item_qty_chk CHECK (quantity > 0 AND "unitPrice" >= 0 AND "totalPrice" >= 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_item_invoice    ON "InvoiceItem" ("invoiceId");
CREATE INDEX IF NOT EXISTS idx_invoice_item_service    ON "InvoiceItem" ("serviceUnitId") WHERE "serviceUnitId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_item_costcenter ON "InvoiceItem" ("costCenterId")  WHERE "costCenterId"  IS NOT NULL;

ALTER TABLE "InvoiceItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_item_tenant ON "InvoiceItem";
CREATE POLICY invoice_item_tenant ON "InvoiceItem"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "InvoiceItem"."invoiceId"
                 AND i."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "InvoiceItem"."invoiceId"
                 AND i."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid));

-- ─── InvoicePayment ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InvoicePayment" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoiceId"       uuid NOT NULL REFERENCES "Invoice"(id) ON DELETE RESTRICT,
  "paidAt"          timestamptz NOT NULL DEFAULT now(),
  amount            numeric(14,2) NOT NULL,
  method            payment_method NOT NULL,
  "referenceNumber" varchar(80),
  notes             text,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "createdBy"       uuid,
  CONSTRAINT invoice_payment_amount_chk CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_payment_invoice ON "InvoicePayment" ("invoiceId");
CREATE INDEX IF NOT EXISTS idx_invoice_payment_paid    ON "InvoicePayment" ("paidAt" DESC);

ALTER TABLE "InvoicePayment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_payment_tenant ON "InvoicePayment";
CREATE POLICY invoice_payment_tenant ON "InvoicePayment"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "InvoicePayment"."invoiceId"
                 AND i."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "InvoicePayment"."invoiceId"
                 AND i."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid));

-- ─── InsuranceClaim ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InsuranceClaim" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoiceId"         uuid NOT NULL REFERENCES "Invoice"(id) ON DELETE RESTRICT,
  "insurerId"         uuid NOT NULL REFERENCES "Insurer"(id) ON DELETE RESTRICT,
  "claimNumber"       varchar(80) NOT NULL,
  "submittedAt"       timestamptz NOT NULL DEFAULT now(),
  "respondedAt"       timestamptz,
  status              claim_status NOT NULL DEFAULT 'SUBMITTED',
  "submittedAmount"   numeric(14,2) NOT NULL DEFAULT 0,
  "approvedAmount"    numeric(14,2) NOT NULL DEFAULT 0,
  "rejectedAmount"    numeric(14,2) NOT NULL DEFAULT 0,
  "rejectionReason"   text,
  notes               text,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "createdBy"         uuid,
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedBy"         uuid,
  UNIQUE ("insurerId", "claimNumber"),
  CONSTRAINT claim_amounts_chk CHECK (
    "submittedAmount" >= 0
    AND "approvedAmount" >= 0
    AND "rejectedAmount" >= 0
    AND "approvedAmount" + "rejectedAmount" <= "submittedAmount" + 0.01
  )
);

CREATE INDEX IF NOT EXISTS idx_claim_invoice  ON "InsuranceClaim" ("invoiceId");
CREATE INDEX IF NOT EXISTS idx_claim_insurer  ON "InsuranceClaim" ("insurerId", "submittedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_claim_status   ON "InsuranceClaim" (status, "submittedAt" DESC);

ALTER TABLE "InsuranceClaim" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insurance_claim_tenant ON "InsuranceClaim";
CREATE POLICY insurance_claim_tenant ON "InsuranceClaim"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "InsuranceClaim"."invoiceId"
                 AND i."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "InsuranceClaim"."invoiceId"
                 AND i."organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid));

-- ─── Trigger: actualizar Invoice.paidAmount + status al insertar/eliminar pagos ──
CREATE OR REPLACE FUNCTION fn_invoice_recalc_payments()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_invoice_id uuid;
  v_total     numeric(14,2);
  v_paid      numeric(14,2);
BEGIN
  v_invoice_id := COALESCE(NEW."invoiceId", OLD."invoiceId");
  SELECT "totalAmount", COALESCE(SUM(amount), 0)
    INTO v_total, v_paid
    FROM "Invoice" i
    LEFT JOIN "InvoicePayment" p ON p."invoiceId" = i.id
    WHERE i.id = v_invoice_id
    GROUP BY i."totalAmount";
  UPDATE "Invoice"
     SET "paidAmount" = v_paid,
         status = CASE
           WHEN v_paid >= v_total AND v_total > 0 THEN 'PAID'::invoice_status
           WHEN v_paid > 0 THEN 'PARTIALLY_PAID'::invoice_status
           WHEN status IN ('PAID','PARTIALLY_PAID') THEN 'ISSUED'::invoice_status
           ELSE status
         END,
         "updatedAt" = now()
   WHERE id = v_invoice_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_payment_recalc ON "InvoicePayment";
CREATE TRIGGER trg_invoice_payment_recalc
  AFTER INSERT OR UPDATE OR DELETE ON "InvoicePayment"
  FOR EACH ROW EXECUTE FUNCTION fn_invoice_recalc_payments();
