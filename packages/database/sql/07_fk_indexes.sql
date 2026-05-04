-- =============================================================================
-- HIS Multi-país | Índices sobre foreign keys (perf hardening)
-- 31 FKs sin índice surfaceadas durante cierre G0 (advisor pass).
-- Postgres no auto-indexa FKs; sin índice DELETE/UPDATE CASCADE hace seq scan
-- en la tabla referenciante. Aceptable en staging sin volumen, crítico en prod.
--
-- Aplicar: node scripts/apply-sql.mjs 07_fk_indexes.sql
--
-- Para producción usar `CREATE INDEX CONCURRENTLY` (no bloquea writes); aquí
-- usamos `CREATE INDEX IF NOT EXISTS` no-CONCURRENT porque la tabla está
-- vacía o casi-vacía en staging.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_bed_organizationid ON public."Bed" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_bed_serviceunitid ON public."Bed" ("serviceUnitId");
CREATE INDEX IF NOT EXISTS idx_deathcertificate_encounterid ON public."DeathCertificate" ("encounterId");
CREATE INDEX IF NOT EXISTS idx_encounter_currencyid ON public."Encounter" ("currencyId");
CREATE INDEX IF NOT EXISTS idx_encounter_establishmentid ON public."Encounter" ("establishmentId");
CREATE INDEX IF NOT EXISTS idx_encounter_patientcategoryid ON public."Encounter" ("patientCategoryId");
CREATE INDEX IF NOT EXISTS idx_encounter_patienttypeid ON public."Encounter" ("patientTypeId");
CREATE INDEX IF NOT EXISTS idx_encounter_serviceunitid ON public."Encounter" ("serviceUnitId");
CREATE INDEX IF NOT EXISTS idx_ledger_currencyid ON public."Ledger" ("currencyId");
CREATE INDEX IF NOT EXISTS idx_medicalspecialty_parentid ON public."MedicalSpecialty" ("parentId");
CREATE INDEX IF NOT EXISTS idx_organization_functionalcurrency ON public."Organization" ("functionalCurrency");
CREATE INDEX IF NOT EXISTS idx_organization_reportingcurrency ON public."Organization" ("reportingCurrency");
CREATE INDEX IF NOT EXISTS idx_patient_biologicalsexid ON public."Patient" ("biologicalSexId");
CREATE INDEX IF NOT EXISTS idx_patient_educationlevelid ON public."Patient" ("educationLevelId");
CREATE INDEX IF NOT EXISTS idx_patient_genderid ON public."Patient" ("genderId");
CREATE INDEX IF NOT EXISTS idx_patient_maritalstatusid ON public."Patient" ("maritalStatusId");
CREATE INDEX IF NOT EXISTS idx_patient_motherpatientid ON public."Patient" ("motherPatientId");
CREATE INDEX IF NOT EXISTS idx_patient_occupationid ON public."Patient" ("occupationId");
CREATE INDEX IF NOT EXISTS idx_patientconsent_signedbyid ON public."PatientConsent" ("signedById");
CREATE INDEX IF NOT EXISTS idx_patientmerge_frompatientid ON public."PatientMerge" ("fromPatientId");
CREATE INDEX IF NOT EXISTS idx_patientvaccination_organizationid ON public."PatientVaccination" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_serviceunit_organizationid ON public."ServiceUnit" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_serviceunit_specialtyid ON public."ServiceUnit" ("specialtyId");
CREATE INDEX IF NOT EXISTS idx_triagediscriminator_resultlevelid ON public."TriageDiscriminator" ("resultLevelId");
CREATE INDEX IF NOT EXISTS idx_triageevaluation_encounterid ON public."TriageEvaluation" ("encounterId");
CREATE INDEX IF NOT EXISTS idx_triageevaluation_establishmentid ON public."TriageEvaluation" ("establishmentId");
CREATE INDEX IF NOT EXISTS idx_triageevaluation_flowchartid ON public."TriageEvaluation" ("flowchartId");
CREATE INDEX IF NOT EXISTS idx_triageevaluation_retriageofid ON public."TriageEvaluation" ("reTriageOfId");
CREATE INDEX IF NOT EXISTS idx_triageevaluation_serviceunitid ON public."TriageEvaluation" ("serviceUnitId");
CREATE INDEX IF NOT EXISTS idx_triageflowchart_defaultlevelid ON public."TriageFlowchart" ("defaultLevelId");
CREATE INDEX IF NOT EXISTS idx_userexternalidentity_userid ON public."UserExternalIdentity" ("userId");
