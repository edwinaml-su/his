-- =============================================================================
-- HIS Multi-país | RLS Policies
-- TDR §5.5 (regla 6): aislamiento por organization_id vía auth.jwt().
-- TDR §6.2: ABAC capa adicional sobre el RBAC aplicado.
--
-- Convenciones:
--   - JWT debe llevar claims:
--       org_id        : UUID de la organización activa
--       user_id       : UUID del usuario
--       country_id    : UUID del país (para aislamiento país opcional)
--       role_codes    : array de codes (text[])
--       break_glass   : true|false (acceso de emergencia, auditado aparte)
--   - Las funciones helper toleran ausencia del JWT en jobs administrativos
--     ejecutados con role 'service_role'.
-- =============================================================================

-- Helpers JWT --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    coalesce(
      current_setting('request.jwt.claim.org_id', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')
    ),
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    coalesce(
      current_setting('request.jwt.claim.user_id', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'user_id')
    ),
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION public.current_country_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    coalesce(
      current_setting('request.jwt.claim.country_id', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'country_id')
    ),
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION public.is_break_glass()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'break_glass')::boolean,
    false
  );
$$;

-- ¿El usuario tiene rol activo en la organización? -------------------------
CREATE OR REPLACE FUNCTION public.user_has_org_access(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public."UserOrganizationRole" uor
     WHERE uor."userId"         = public.current_user_id()
       AND uor."organizationId" = p_org
       AND (uor."validTo" IS NULL OR uor."validTo" > now())
  );
$$;

-- =============================================================================
-- ENABLE RLS sobre tablas tenant-scoped
-- =============================================================================
ALTER TABLE public."Organization"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Establishment"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Ledger"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ServiceUnit"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Bed"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Patient"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientIdentifier"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientAddress"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientPhone"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientEmail"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientEmergencyContact"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientEthnicity"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientReligion"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientLanguage"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientAllergy"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientConsent"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PatientMerge"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Encounter"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BedAssignment"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EncounterTransfer"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TriageLevel"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TriageFlowchart"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TriageDiscriminator"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TriageFlowchartVitalSign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TriageEvaluation"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TriageVitalSign"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TriageDiscriminatorHit"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Role"                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UserOrganizationRole"     ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- POLICIES: organización propia
-- =============================================================================

-- Organization: jerarquía propia + holding/empresas hijas accesibles si user tiene rol.
DROP POLICY IF EXISTS org_self_select ON public."Organization";
CREATE POLICY org_self_select ON public."Organization"
  FOR SELECT
  USING (id = public.current_org_id() OR public.user_has_org_access(id));

DROP POLICY IF EXISTS org_self_modify ON public."Organization";
CREATE POLICY org_self_modify ON public."Organization"
  FOR ALL
  USING (id = public.current_org_id())
  WITH CHECK (id = public.current_org_id());

-- Patrón genérico: tablas con organizationId.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'Establishment','Ledger','ServiceUnit','Bed','Patient',
    'Encounter','TriageLevel','TriageFlowchart','TriageEvaluation',
    'Role','UserOrganizationRole'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON public.%I
         FOR SELECT
         USING ("organizationId" = public.current_org_id() OR public.is_break_glass())',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_modify ON public.%I
         FOR ALL
         USING ("organizationId" = public.current_org_id())
         WITH CHECK ("organizationId" = public.current_org_id())',
      t
    );
  END LOOP;
END$$;

-- Tablas hijas que heredan tenant del Patient/Encounter -----------------------
DROP POLICY IF EXISTS patient_child_isolation_pi ON public."PatientIdentifier";
CREATE POLICY patient_child_isolation_pi ON public."PatientIdentifier"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public."Patient" p
                  WHERE p.id = "patientId"
                    AND p."organizationId" = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public."Patient" p
                       WHERE p.id = "patientId"
                         AND p."organizationId" = public.current_org_id()));

DO $$
DECLARE
  t text;
  ptables text[] := ARRAY[
    'PatientAddress','PatientPhone','PatientEmail','PatientEmergencyContact',
    'PatientEthnicity','PatientReligion','PatientLanguage','PatientAllergy',
    'PatientConsent'
  ];
BEGIN
  FOREACH t IN ARRAY ptables LOOP
    EXECUTE format('DROP POLICY IF EXISTS patient_child_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY patient_child_isolation ON public.%I
         FOR ALL
         USING (EXISTS (SELECT 1 FROM public."Patient" p
                          WHERE p.id = "patientId"
                            AND p."organizationId" = public.current_org_id()))
         WITH CHECK (EXISTS (SELECT 1 FROM public."Patient" p
                              WHERE p.id = "patientId"
                                AND p."organizationId" = public.current_org_id()))',
      t
    );
  END LOOP;
END$$;

-- BedAssignment / EncounterTransfer: heredan de Encounter -----------------
DROP POLICY IF EXISTS enc_child_iso_ba ON public."BedAssignment";
CREATE POLICY enc_child_iso_ba ON public."BedAssignment"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public."Encounter" e
                  WHERE e.id = "encounterId"
                    AND e."organizationId" = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public."Encounter" e
                       WHERE e.id = "encounterId"
                         AND e."organizationId" = public.current_org_id()));

DROP POLICY IF EXISTS enc_child_iso_et ON public."EncounterTransfer";
CREATE POLICY enc_child_iso_et ON public."EncounterTransfer"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public."Encounter" e
                  WHERE e.id = "encounterId"
                    AND e."organizationId" = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public."Encounter" e
                       WHERE e.id = "encounterId"
                         AND e."organizationId" = public.current_org_id()));

-- Triage hijas: heredan de TriageEvaluation / TriageFlowchart -----------------
DROP POLICY IF EXISTS triage_disc_iso ON public."TriageDiscriminator";
CREATE POLICY triage_disc_iso ON public."TriageDiscriminator"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public."TriageFlowchart" f
                  WHERE f.id = "flowchartId"
                    AND f."organizationId" = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public."TriageFlowchart" f
                       WHERE f.id = "flowchartId"
                         AND f."organizationId" = public.current_org_id()));

DROP POLICY IF EXISTS triage_fvs_iso ON public."TriageFlowchartVitalSign";
CREATE POLICY triage_fvs_iso ON public."TriageFlowchartVitalSign"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public."TriageFlowchart" f
                  WHERE f.id = "flowchartId"
                    AND f."organizationId" = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public."TriageFlowchart" f
                       WHERE f.id = "flowchartId"
                         AND f."organizationId" = public.current_org_id()));

DROP POLICY IF EXISTS triage_vs_iso ON public."TriageVitalSign";
CREATE POLICY triage_vs_iso ON public."TriageVitalSign"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public."TriageEvaluation" e
                  WHERE e.id = "evaluationId"
                    AND e."organizationId" = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public."TriageEvaluation" e
                       WHERE e.id = "evaluationId"
                         AND e."organizationId" = public.current_org_id()));

DROP POLICY IF EXISTS triage_dh_iso ON public."TriageDiscriminatorHit";
CREATE POLICY triage_dh_iso ON public."TriageDiscriminatorHit"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public."TriageEvaluation" e
                  WHERE e.id = "evaluationId"
                    AND e."organizationId" = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public."TriageEvaluation" e
                       WHERE e.id = "evaluationId"
                         AND e."organizationId" = public.current_org_id()));

DROP POLICY IF EXISTS patient_merge_iso ON public."PatientMerge";
CREATE POLICY patient_merge_iso ON public."PatientMerge"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public."Patient" p
                  WHERE p.id = "toPatientId"
                    AND p."organizationId" = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public."Patient" p
                       WHERE p.id = "toPatientId"
                         AND p."organizationId" = public.current_org_id()));

-- =============================================================================
-- Soft delete: ocultar deletedAt en SELECT salvo break-glass.
-- TDR §5.5 regla 7.
-- =============================================================================
DROP POLICY IF EXISTS patient_soft_delete ON public."Patient";
CREATE POLICY patient_soft_delete ON public."Patient"
  AS RESTRICTIVE
  FOR SELECT
  USING ("deletedAt" IS NULL OR public.is_break_glass());

-- =============================================================================
-- Notas:
-- 1. service_role bypass (Supabase): se concede BYPASSRLS a un rol específico
--    para jobs administrativos y migraciones.
-- 2. break_glass se audita en audit.AuditLog con justification obligatoria
--    (constraint enforced en aplicación + trigger).
-- =============================================================================
