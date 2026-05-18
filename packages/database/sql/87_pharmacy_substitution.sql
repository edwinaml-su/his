-- =============================================================================
-- F2-S7 GS1 Bedside | PharmacySubstitution + MedicationGtin
-- Sprint F2-S7, Proceso D
--
-- Crea:
--   1. Tabla "PharmacySubstitution" — intercambio terapéutico con trazabilidad GTIN
--   2. Tabla "MedicationGtin" — catálogo GTIN extendido con alertas recall/alergenos
--
-- Ambas con:
--   - RLS por organizationId
--   - Audit triggers (hash chain completo — datos regulatorios)
--
-- Idempotente.
-- =============================================================================

-- 1. Tabla PharmacySubstitution -----------------------------------------------
CREATE TABLE IF NOT EXISTS public."PharmacySubstitution" (
  "id"               uuid        NOT NULL DEFAULT gen_random_uuid(),
  "organizationId"   uuid        NOT NULL,
  "pharmacyOrderId"  uuid        NOT NULL,
  "gtinOriginal"     varchar(14) NOT NULL,
  "gtinSustituto"    varchar(14) NOT NULL,
  "autorizadoPorId"  uuid        NOT NULL,
  "autorizadoEn"     timestamptz NOT NULL DEFAULT now(),
  "motivo"           varchar(500) NOT NULL,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PharmacySubstitution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PharmacySubstitution_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE RESTRICT,
  CONSTRAINT "PharmacySubstitution_pharmacyOrderId_fkey"
    FOREIGN KEY ("pharmacyOrderId") REFERENCES public."PharmacyOrder"("id") ON DELETE RESTRICT,
  CONSTRAINT "PharmacySubstitution_autorizadoPorId_fkey"
    FOREIGN KEY ("autorizadoPorId") REFERENCES public."User"("id") ON DELETE RESTRICT,
  CONSTRAINT "pharmacy_substitution_gtin_original_format_chk"
    CHECK ("gtinOriginal" ~ '^\d{14}$'),
  CONSTRAINT "pharmacy_substitution_gtin_sustituto_format_chk"
    CHECK ("gtinSustituto" ~ '^\d{14}$'),
  CONSTRAINT "pharmacy_substitution_gtin_different_chk"
    CHECK ("gtinOriginal" <> "gtinSustituto"),
  CONSTRAINT "pharmacy_substitution_motivo_nonempty_chk"
    CHECK (trim("motivo") <> '')
);

-- 2. Índices PharmacySubstitution ---------------------------------------------
CREATE INDEX IF NOT EXISTS ix_pharmacy_substitution_org
  ON public."PharmacySubstitution" ("organizationId");

CREATE INDEX IF NOT EXISTS ix_pharmacy_substitution_order
  ON public."PharmacySubstitution" ("pharmacyOrderId");

CREATE INDEX IF NOT EXISTS ix_pharmacy_substitution_autorizado_por
  ON public."PharmacySubstitution" ("autorizadoPorId");

-- 3. Audit trigger PharmacySubstitution (hash chain completo) -----------------
DROP TRIGGER IF EXISTS tr_audit_pharmacy_substitution ON public."PharmacySubstitution";
CREATE TRIGGER tr_audit_pharmacy_substitution
  AFTER INSERT OR UPDATE OR DELETE ON public."PharmacySubstitution"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- 4. RLS PharmacySubstitution -------------------------------------------------
ALTER TABLE public."PharmacySubstitution" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PharmacySubstitution_tenant_isolation" ON public."PharmacySubstitution";
CREATE POLICY "PharmacySubstitution_tenant_isolation"
  ON public."PharmacySubstitution"
  FOR ALL
  TO authenticated
  USING (
    "organizationId" = nullif(
      current_setting('app.current_org_id', true), ''
    )::uuid
  )
  WITH CHECK (
    "organizationId" = nullif(
      current_setting('app.current_org_id', true), ''
    )::uuid
  );

-- 5. Tabla MedicationGtin — catálogo GTIN con alertas GS1 Healthcare ----------
CREATE TABLE IF NOT EXISTS public."MedicationGtin" (
  "id"                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  "organizationId"       uuid        NOT NULL,
  -- GTIN-14 (identificador GS1 único)
  "gtin"                 varchar(14) NOT NULL,
  "brandName"            varchar(200) NOT NULL,
  "strengthForm"         varchar(200),
  -- Principios activos (array; vacío si no especificado)
  "activeIngredients"    text[]      NOT NULL DEFAULT '{}',
  -- Excipientes alergénicos (GS1 Healthcare alert fields)
  "excipientesAlergenos" text[]      NOT NULL DEFAULT '{}',
  -- Estado recall: NONE | VOLUNTARY | MANDATORY | MARKET_WITHDRAWAL
  "recallStatus"         varchar(40) NOT NULL DEFAULT 'NONE',
  -- FK opcional al Drug.id del HIS core
  "drugId"               uuid,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "MedicationGtin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationGtin_gtin_unique" UNIQUE ("gtin"),
  CONSTRAINT "MedicationGtin_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES public."Organization"("id") ON DELETE RESTRICT,
  CONSTRAINT "MedicationGtin_gtin_format_chk"
    CHECK ("gtin" ~ '^\d{14}$'),
  CONSTRAINT "MedicationGtin_recall_status_chk"
    CHECK ("recallStatus" IN ('NONE', 'VOLUNTARY', 'MANDATORY', 'MARKET_WITHDRAWAL'))
);

-- 6. Índices MedicationGtin ---------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_medication_gtin_org
  ON public."MedicationGtin" ("organizationId");

CREATE INDEX IF NOT EXISTS ix_medication_gtin_gtin
  ON public."MedicationGtin" ("gtin");

-- Índice parcial para queries de recall activo (frecuentes en bedside alert).
CREATE INDEX IF NOT EXISTS ix_medication_gtin_recall_active
  ON public."MedicationGtin" ("recallStatus")
  WHERE "recallStatus" <> 'NONE';

-- GIN para búsqueda por principio activo.
CREATE INDEX IF NOT EXISTS ix_medication_gtin_active_ingredients_gin
  ON public."MedicationGtin" USING gin ("activeIngredients");

-- 7. updatedAt automático MedicationGtin -------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_updated_at_medication_gtin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_medication_gtin_updated_at ON public."MedicationGtin";
CREATE TRIGGER tr_medication_gtin_updated_at
  BEFORE UPDATE ON public."MedicationGtin"
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at_medication_gtin();

-- 8. Audit trigger MedicationGtin ---------------------------------------------
DROP TRIGGER IF EXISTS tr_audit_medication_gtin ON public."MedicationGtin";
CREATE TRIGGER tr_audit_medication_gtin
  AFTER INSERT OR UPDATE OR DELETE ON public."MedicationGtin"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- 9. RLS MedicationGtin -------------------------------------------------------
ALTER TABLE public."MedicationGtin" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "MedicationGtin_tenant_isolation" ON public."MedicationGtin";
CREATE POLICY "MedicationGtin_tenant_isolation"
  ON public."MedicationGtin"
  FOR ALL
  TO authenticated
  USING (
    "organizationId" = nullif(
      current_setting('app.current_org_id', true), ''
    )::uuid
  )
  WITH CHECK (
    "organizationId" = nullif(
      current_setting('app.current_org_id', true), ''
    )::uuid
  );
