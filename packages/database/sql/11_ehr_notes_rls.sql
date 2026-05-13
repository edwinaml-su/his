-- =============================================================================
-- HIS Multi-país | RLS Policies — §14 EHR Clinical Notes (Sprint 4 / Phase 4)
--
-- Cobertura:
--   - public."ClinicalNote"            — tenant-isolation directo (organizationId).
--   - public."ClinicalNoteAttachment"  — hereda de ClinicalNote (via noteId).
--   - public."EncounterDiagnosis"      — hereda de Encounter (via encounterId).
--
-- Nota: ClinicalNote.signedAt no requiere policy aparte — la inmutabilidad post-firma
-- se enforce en el router (ehr-notes.router.ts: sign rechaza si ya firmada; addendum
-- crea note nueva). RLS sólo gobierna visibilidad cross-tenant.
--
-- Idempotente. Aplicar DESPUÉS de mergear claude/team5-ehr-notes.
-- =============================================================================

ALTER TABLE public."ClinicalNote"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ClinicalNoteAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EncounterDiagnosis"     ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public."ClinicalNote"           TO authenticated;
GRANT SELECT ON public."ClinicalNoteAttachment" TO authenticated;
GRANT SELECT ON public."EncounterDiagnosis"     TO authenticated;

-- ClinicalNote: tenant-isolation directo --------------------------------------
DROP POLICY IF EXISTS clinical_note_tenant_select ON public."ClinicalNote";
CREATE POLICY clinical_note_tenant_select ON public."ClinicalNote"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS clinical_note_tenant_modify ON public."ClinicalNote";
CREATE POLICY clinical_note_tenant_modify ON public."ClinicalNote"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

-- ClinicalNoteAttachment: hereda de ClinicalNote (vía noteId) -----------------
DROP POLICY IF EXISTS clinical_note_attachment_inherit ON public."ClinicalNoteAttachment";
CREATE POLICY clinical_note_attachment_inherit ON public."ClinicalNoteAttachment"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."ClinicalNote" n
     WHERE n.id = "noteId"
       AND n."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."ClinicalNote" n
     WHERE n.id = "noteId"
       AND n."organizationId" = public.current_org_id()
  ));

-- EncounterDiagnosis: hereda de Encounter (vía encounterId) -------------------
DROP POLICY IF EXISTS encounter_diagnosis_inherit ON public."EncounterDiagnosis";
CREATE POLICY encounter_diagnosis_inherit ON public."EncounterDiagnosis"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."Encounter" e
     WHERE e.id = "encounterId"
       AND e."organizationId" = public.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Encounter" e
     WHERE e.id = "encounterId"
       AND e."organizationId" = public.current_org_id()
  ));
