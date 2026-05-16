-- =============================================================================
-- HIS Multi-país | Beta.17 — Patología / Anatomía Patológica (TDR §16)
-- Hardening: RLS tenant-isolation + audit triggers + hash chain + constraints.
--
-- Tablas cubiertas:
--   "PathologyOrder"        — solicitud médica de estudio
--   "PathologySpecimen"     — muestra recibida
--   "PathologyMacroDescription" — descripción macroscópica
--   "PathologyMicroDescription" — descripción microscópica
--   "PathologyReport"       — reporte final firmado (immutable post-sign, ADR 0004)
--
-- Precedentes de diseño:
--   - Patrón RLS: 45_blood_bank_hardening.sql
--   - Audit trigger genérico: 02_audit_triggers.sql (fn_audit_row)
--   - Hash chain: 05_audit_hash_chain.sql (fn_audit_log_chain)
--   - Enum + index en tx separada: 30a_surgery_enum_post_op.sql
--
-- NOTA NAMING: Prisma genera tablas PascalCase con columnas "camelCase" (quoted).
--   => referencias SQL usan comillas dobles para columnas camelCase.
-- =============================================================================

-- =============================================================================
-- 1. RLS — tenant isolation (organizationId) en las 5 tablas
-- =============================================================================

ALTER TABLE public."PathologyOrder"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PathologySpecimen"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PathologyMacroDescription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PathologyMicroDescription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PathologyReport"         ENABLE ROW LEVEL SECURITY;

-- PathologyOrder
DROP POLICY IF EXISTS tenant_isolation ON public."PathologyOrder";
CREATE POLICY tenant_isolation ON public."PathologyOrder"
  USING (
    "organizationId" = public.current_org_id()
    OR public.is_break_glass()
  );

-- PathologyReport (tiene organizationId directo)
DROP POLICY IF EXISTS tenant_isolation ON public."PathologyReport";
CREATE POLICY tenant_isolation ON public."PathologyReport"
  USING (
    "organizationId" = public.current_org_id()
    OR public.is_break_glass()
  );

-- PathologySpecimen — tenant vía PathologyOrder.organizationId
DROP POLICY IF EXISTS tenant_isolation ON public."PathologySpecimen";
CREATE POLICY tenant_isolation ON public."PathologySpecimen"
  USING (
    EXISTS (
      SELECT 1
        FROM public."PathologyOrder" po
       WHERE po.id = "PathologySpecimen"."orderId"
         AND (
           po."organizationId" = public.current_org_id()
           OR public.is_break_glass()
         )
    )
  );

-- PathologyMacroDescription — tenant vía PathologySpecimen → PathologyOrder
DROP POLICY IF EXISTS tenant_isolation ON public."PathologyMacroDescription";
CREATE POLICY tenant_isolation ON public."PathologyMacroDescription"
  USING (
    EXISTS (
      SELECT 1
        FROM public."PathologySpecimen" ps
        JOIN public."PathologyOrder"    po ON po.id = ps."orderId"
       WHERE ps.id = "PathologyMacroDescription"."specimenId"
         AND (
           po."organizationId" = public.current_org_id()
           OR public.is_break_glass()
         )
    )
  );

-- PathologyMicroDescription — mismo patrón que Macro
DROP POLICY IF EXISTS tenant_isolation ON public."PathologyMicroDescription";
CREATE POLICY tenant_isolation ON public."PathologyMicroDescription"
  USING (
    EXISTS (
      SELECT 1
        FROM public."PathologySpecimen" ps
        JOIN public."PathologyOrder"    po ON po.id = ps."orderId"
       WHERE ps.id = "PathologyMicroDescription"."specimenId"
         AND (
           po."organizationId" = public.current_org_id()
           OR public.is_break_glass()
         )
    )
  );

-- =============================================================================
-- 2. CHECK constraints — reglas de negocio a nivel BD
-- =============================================================================

-- PathologyReport: status=FINAL ⇒ signedAt + pathologistId (signedBy) obligatorios
ALTER TABLE public."PathologyReport"
  DROP CONSTRAINT IF EXISTS chk_pathology_report_final_signed;
ALTER TABLE public."PathologyReport"
  ADD CONSTRAINT chk_pathology_report_final_signed CHECK (
    status != 'FINAL' OR (
      "signedAt" IS NOT NULL AND "pathologistId" IS NOT NULL
    )
  );

-- PathologyReport: status=AMENDED ⇒ amendmentReason obligatorio
ALTER TABLE public."PathologyReport"
  DROP CONSTRAINT IF EXISTS chk_pathology_report_amended_reason;
ALTER TABLE public."PathologyReport"
  ADD CONSTRAINT chk_pathology_report_amended_reason CHECK (
    status != 'AMENDED' OR "amendmentReason" IS NOT NULL
  );

-- PathologyOrder: priority debe ser ROUTINE, URGENT o STAT
ALTER TABLE public."PathologyOrder"
  DROP CONSTRAINT IF EXISTS chk_pathology_order_priority;
ALTER TABLE public."PathologyOrder"
  ADD CONSTRAINT chk_pathology_order_priority CHECK (
    priority IN ('ROUTINE', 'URGENT', 'STAT')
  );

-- PathologySpecimen: fixative debe ser valor conocido
ALTER TABLE public."PathologySpecimen"
  DROP CONSTRAINT IF EXISTS chk_pathology_specimen_fixative;
ALTER TABLE public."PathologySpecimen"
  ADD CONSTRAINT chk_pathology_specimen_fixative CHECK (
    fixative IN ('FORMALIN', 'FRESH', 'FROZEN', 'OTHER')
  );

-- =============================================================================
-- 3. Inmutabilidad post-firma — ADR 0004
--    PathologyReport con status=FINAL no puede ser modificado ni eliminado.
--    AMENDED crea una nueva fila (no update del original).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_pathology_report_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Bloquea UPDATE de un reporte que ya está FINAL.
  -- Excepción: actualizar signatureHash/prevHash (escritura del hash chain trigger).
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'FINAL'
       AND NOT (
         -- Permitimos sólo la escritura del hash chain al momento de insertar.
         -- En UPDATE post-INSERT no debe ocurrir, pero dejamos esta cláusula
         -- por defensividad ante triggers anidados del hash chain.
         NEW."signatureHash" IS NOT NULL AND OLD."signatureHash" IS NULL
       )
    THEN
      RAISE EXCEPTION
        'PathologyReport id=% con status=FINAL es inmutable (ADR 0004). '
        'Para enmendar cree una fila nueva con status=AMENDED y amendedFromId.',
        OLD.id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'FINAL' THEN
      RAISE EXCEPTION
        'PathologyReport id=% con status=FINAL no puede eliminarse (ADR 0004).',
        OLD.id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD; -- DELETE
END;
$$;

DROP TRIGGER IF EXISTS trg_pathology_report_immutable ON public."PathologyReport";
CREATE TRIGGER trg_pathology_report_immutable
  BEFORE UPDATE OR DELETE ON public."PathologyReport"
  FOR EACH ROW EXECUTE FUNCTION public.fn_pathology_report_immutable();

-- =============================================================================
-- 4. Audit triggers — extiende 02_audit_triggers.sql + 22_audit_triggers_phase2.sql
--    fn_audit_row() ya existe; solo registrar las tablas.
-- =============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'PathologyOrder',
    'PathologySpecimen',
    'PathologyMacroDescription',
    'PathologyMicroDescription',
    'PathologyReport'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_audit_%I ON public."%I";', t, t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%I
         AFTER INSERT OR UPDATE OR DELETE ON public."%I"
         FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();',
      t, t
    );
  END LOOP;
END;
$$;

-- =============================================================================
-- 5. Hash chain — PathologyReport (immutable post-sign, TDR §6.3 + ADR 0004)
--    Extiende el patrón de 05_audit_hash_chain.sql aplicado a audit.AuditLog.
--    Aquí lo aplicamos directamente en PathologyReport para tamper-evidence
--    en informes clínicos firmados (no solo en el audit log genérico).
-- =============================================================================

-- 5a) Función de cálculo del hash de un PathologyReport
CREATE OR REPLACE FUNCTION public.fn_pathology_report_chain_hash(rec public."PathologyReport")
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(
    digest(
      coalesce(rec."prevHash", '')              ||
      rec.id::text                               ||
      rec."organizationId"::text                 ||
      rec."orderId"::text                        ||
      rec."pathologistId"::text                  ||
      coalesce(rec."primaryDiagnosis", '')       ||
      coalesce(rec."signedAt"::text, '')         ||
      rec.status::text,
      'sha256'
    ),
    'hex'
  );
$$;

-- 5b) Trigger BEFORE INSERT que encadena prevHash + signatureHash
CREATE OR REPLACE FUNCTION public.fn_pathology_report_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_prev_hash text;
BEGIN
  -- Serializar INSERTs para evitar prevHash duplicado bajo concurrencia.
  LOCK TABLE public."PathologyReport" IN EXCLUSIVE MODE;

  SELECT "signatureHash"
    INTO v_prev_hash
    FROM public."PathologyReport"
   ORDER BY "createdAt" DESC, id DESC
   LIMIT 1;

  NEW."prevHash"       := v_prev_hash;
  NEW."signatureHash"  := public.fn_pathology_report_chain_hash(NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pathology_report_hash_chain ON public."PathologyReport";
CREATE TRIGGER trg_pathology_report_hash_chain
  BEFORE INSERT ON public."PathologyReport"
  FOR EACH ROW EXECUTE FUNCTION public.fn_pathology_report_hash_chain();

-- 5c) Función de verificación de la cadena (útil para auditorías forenses)
CREATE OR REPLACE FUNCTION public.fn_verify_pathology_report_chain(from_id uuid DEFAULT NULL)
RETURNS TABLE (
  id              uuid,
  status          text,
  "signedAt"      timestamptz,
  expected_hash   text,
  stored_hash     text,
  chain_broken    boolean
)
LANGUAGE sql
SET search_path = public, extensions
AS $$
  SELECT
    r.id,
    r.status::text,
    r."signedAt",
    public.fn_pathology_report_chain_hash(r) AS expected_hash,
    r."signatureHash"                         AS stored_hash,
    public.fn_pathology_report_chain_hash(r) IS DISTINCT FROM r."signatureHash" AS chain_broken
  FROM public."PathologyReport" r
  WHERE from_id IS NULL OR r.id >= from_id
  ORDER BY r."createdAt" ASC, r.id ASC;
$$;

-- =============================================================================
-- 6. Índices adicionales de búsqueda (complementan los generados por Prisma)
-- =============================================================================

-- Búsqueda de reportes por paciente vía la orden (join frecuente en HIS)
CREATE INDEX IF NOT EXISTS idx_pathology_report_order_id
  ON public."PathologyReport" ("orderId");

-- Búsqueda de especímenes por orden
CREATE INDEX IF NOT EXISTS idx_pathology_specimen_order_id
  ON public."PathologySpecimen" ("orderId");

-- Reportes FINAL de la organización (consulta de dashboard de patólogo)
CREATE INDEX IF NOT EXISTS idx_pathology_report_org_status
  ON public."PathologyReport" ("organizationId", status);

-- Órdenes activas por médico solicitante
CREATE INDEX IF NOT EXISTS idx_pathology_order_physician
  ON public."PathologyOrder" ("requestingPhysicianId", status);
