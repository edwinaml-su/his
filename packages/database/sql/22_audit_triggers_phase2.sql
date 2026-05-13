-- =============================================================================
-- HIS Multi-país | Audit triggers — extensión Phase 2 (cierre AE-PHASE2-01)
--
-- Wire de audit triggers para las tablas nuevas de Wave 6/7/8.
-- Reusa la función `audit.fn_audit_row()` de `02_audit_triggers.sql`.
-- Idempotente: DROP TRIGGER IF EXISTS antes de cada CREATE.
--
-- TDR §10 §11 §12 §13 §14 §15 §16 §17 §18 §19 §20 §21 §22 §25
-- Regulatorio: MINSAL / JVPM — registro completo en audit.AuditLog.
-- =============================================================================

DO $$
DECLARE
  audited_phase2 text[] := ARRAY[
    -- Wave 6 — §10 Consulta Externa
    'OutpatientAppointment',
    'OutpatientConsultation',

    -- Wave 6/7 — §14 EHR: Notas clínicas, vacunas, defunciones
    'ClinicalNote',
    'ClinicalNoteAttachment',
    'EncounterDiagnosis',
    'Vaccine',
    'PatientVaccination',
    'DeathCertificate',

    -- Wave 7 — §11 Hospitalización
    'InpatientAdmission',
    'InpatientVitals',
    'InpatientKardex',
    'InpatientCarePlan',

    -- Wave 7 — §12 Urgencias
    'EmergencyVisit',
    'EmergencyNote',

    -- Wave 7 — §13 Quirófano
    'OperatingRoom',
    'SurgeryCase',

    -- Wave 7 — §15 Farmacia
    'Drug',
    'Prescription',
    'PrescriptionItem',
    'MedicationDispense',

    -- Wave 7 — §16 eMAR
    'MedicationAdministration',

    -- Wave 7 — §17 LIS (Lab)
    'LabPanel',
    'LabTest',
    'LabOrder',
    'LabOrderItem',
    'LabSpecimen',
    'LabResult',

    -- Wave 7 — §18 RIS/PACS (Imagen)
    'ImagingModality',
    'ImagingOrder',
    'ImagingReport',

    -- Wave 8 — §25 Aseguradoras
    'Insurer',
    'InsurancePlan',
    'PatientCoverage',
    'AuthorizationRequest',

    -- Wave 8 — §19 Inventario
    'StockItem',
    'StockLot',
    'StockMovement',

    -- Wave 8 — §20 Equipos biomédicos
    'BiomedicalEquipment',
    'PmSchedule',
    'CalibrationLog',

    -- Wave 8 — §21 Respiratorio
    'RespiratoryOrder',
    'VentilatorSession',
    'MedicalGasUsage',

    -- Wave 8 — §22 Nutrición
    'DietPlan',
    'NutritionAssessment',
    'NutritionOrder'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY audited_phase2 LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_'||t, t);
    EXECUTE format(
      'CREATE TRIGGER %I
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row()',
      'trg_audit_'||t, t
    );
  END LOOP;
END$$;
