import { router } from "../trpc";
import { countryRouter } from "./country.router";
import { organizationRouter } from "./organization.router";
import { currencyRouter } from "./currency.router";
import { patientRouter } from "./patient.router";
import { encounterRouter } from "./encounter.router";
import { bedRouter } from "./bed.router";
import { triageRouter } from "./triage.router";
import { catalogRouter } from "./catalog.router";
import { auditRouter } from "./audit.router";
import { breakGlassRouter } from "./break-glass.router";
import { consentRouter } from "./consent.router";
import { mfaRouter } from "./mfa.router";
import { exchangeRateRouter } from "./exchange-rate.router";
import { rbacRouter } from "./rbac.router";
import { userAdminRouter } from "./user-admin.router";
import { localeRouter } from "./locale.router";
import { ledgerRouter } from "./ledger.router";
import { auditIntegrityRouter } from "./audit-integrity.router";
import { censusRouter } from "./census.router";
import { deathCertificateRouter } from "./death-certificate.router";
import { encounterDischargeRouter } from "./encounter-discharge.router";
import { encounterTransferRouter } from "./encounter-transfer.router";
import { newbornRouter } from "./newborn.router";
import { patientHistoryRouter } from "./patient-history.router";
import { triageDashboardRouter } from "./triage-dashboard.router";
import { triageFlowchartRouter } from "./triage-flowchart.router";
import { vaccinationRouter } from "./vaccination.router";
import { outpatientRouter } from "./outpatient.router";
import { pharmacyRouter } from "./pharmacy.router";
import { lisRouter } from "./lis.router";
import { ehrNotesRouter } from "./ehr-notes.router";
import { inpatientRouter } from "./inpatient.router";
import { emergencyRouter } from "./emergency.router";
import { surgeryRouter } from "./surgery.router";
import { medicationAdminRouter } from "./medication-admin.router";
import { imagingRouter } from "./imaging.router";
import { insuranceRouter } from "./insurance.router";
import { inventoryRouter } from "./inventory.router";
import { nutritionRouter } from "./nutrition.router";
import { respiratoryRouter } from "./respiratory.router";
import { servicesEquipmentRouter } from "./services-equipment.router";
import { notificationsRouter } from "./notifications.router";
import { bloodBankRouter } from "./blood-bank.router";
import { pathologyRouter } from "./pathology.router";
import { accountingRouter } from "./accounting.router";
import { portalRouter } from "./portal.router";
// Fase 2 — Sprint F2-S1 gate
import { firmaElectronicaRouter } from "./firma-electronica.router";
import { evolucionMedicaRouter } from "./evolucion-medica.router";
import { workflowTipoDocRouter } from "./workflow-tipoDoc.router";
import { workflowEstadoRouter } from "./workflow-estado.router";
import { workflowTransicionRouter } from "./workflow-transicion.router";
import { workflowRolRouter } from "./workflow-rol.router";
import { workflowInstanceRouter } from "./workflow-instance.router";
import { workflowValidatorRouter } from "./workflow-validator.router";
import { eceHistoriaClinicaRouter } from "./ece/historia-clinica.router";
import { eceSignosVitalesRouter } from "./ece/signos-vitales.router";
// Fase 2 — ECE Triaje NTEC (Stream 02)
import { triajeEceRouter } from "./ece/triaje-ece.router";
import { indicacionesMedicasRouter } from "./ece/indicaciones-medicas.router";
import { registroEnfermeriaRouter } from "./ece/registro-enfermeria.router";
import { eceEpisodioRouter } from "./ece/episodio.router";
import { eceConsentimientoRouter } from "./ece/consentimiento.router";
import { epicrisisRouter } from "./ece/epicrisis.router";
// ECE
import { bitacoraRouter } from "./ece/bitacora.router";
import { eceRectificacionRouter } from "./ece-rectificacion.router";
import { eceCertificacionRouter } from "./ece/certificacion.router";
import { eceBridgePatientRouter } from "./ece-bridge-patient.router";
// Fase 2 — Bridge ECE↔HIS (Stream 22b)
import { bridgeEncounterRouter } from "./ece/bridge-encounter.router";
// Fase 2 — Bridge ECE-HIS Triage (Stream 18-ext)
import { eceBridgeTriageRouter } from "./ece/bridge-triage.router";
// Fase 2 — ECE Atención de Emergencia (ATN_EMERG)
import { atencionEmergenciaRouter } from "./ece/atencion-emergencia.router";
// ECE — RRI (Referencia / Retorno / Interconsulta, NTEC Doc 10)
import { eceRriRouter } from "./ece/rri.router";

export const appRouter = router({
  country: countryRouter,
  organization: organizationRouter,
  currency: currencyRouter,
  patient: patientRouter,
  encounter: encounterRouter,
  bed: bedRouter,
  triage: triageRouter,
  catalog: catalogRouter,
  audit: auditRouter,
  breakGlass: breakGlassRouter,
  consent: consentRouter,
  mfa: mfaRouter,
  exchangeRate: exchangeRateRouter,
  rbac: rbacRouter,
  userAdmin: userAdminRouter,
  locale: localeRouter,
  ledger: ledgerRouter,
  auditIntegrity: auditIntegrityRouter,
  census: censusRouter,
  deathCertificate: deathCertificateRouter,
  encounterDischarge: encounterDischargeRouter,
  encounterTransfer: encounterTransferRouter,
  newborn: newbornRouter,
  patientHistory: patientHistoryRouter,
  triageDashboard: triageDashboardRouter,
  triageFlowchart: triageFlowchartRouter,
  vaccination: vaccinationRouter,
  outpatient: outpatientRouter,
  pharmacy: pharmacyRouter,
  lis: lisRouter,
  ehrNotes: ehrNotesRouter,
  inpatient: inpatientRouter,
  emergency: emergencyRouter,
  surgery: surgeryRouter,
  medicationAdmin: medicationAdminRouter,
  imaging: imagingRouter,
  insurance: insuranceRouter,
  inventory: inventoryRouter,
  servicesEquipment: servicesEquipmentRouter,
  respiratory: respiratoryRouter,
  nutrition: nutritionRouter,
  notifications: notificationsRouter,
  bloodBank: bloodBankRouter,
  pathology: pathologyRouter,
  accounting: accountingRouter,
  portal: portalRouter,
  // Fase 2 — F2-S1
  firma: firmaElectronicaRouter,
  eceEvolucion: evolucionMedicaRouter,
  workflowTipoDoc: workflowTipoDocRouter,
  workflowEstado: workflowEstadoRouter,
  workflowTransicion: workflowTransicionRouter,
  workflowRol: workflowRolRouter,
  workflowInstance: workflowInstanceRouter,
  workflowValidator: workflowValidatorRouter,
  eceHistoriaClinica: eceHistoriaClinicaRouter,
  eceSignosVitales: eceSignosVitalesRouter,
  // Fase 2 — ECE Triaje NTEC (Stream 02)
  eceTriaje: triajeEceRouter,
  eceIndicaciones: indicacionesMedicasRouter,
  eceRegistroEnfermeria: registroEnfermeriaRouter,
  eceEpisodio: eceEpisodioRouter,
  eceConsentimiento: eceConsentimientoRouter,
  eceEpicrisis: epicrisisRouter,
  // ECE
  bitacora: bitacoraRouter,
  eceRectificacion: eceRectificacionRouter,
  eceCertificacion: eceCertificacionRouter,
  eceBridge: eceBridgePatientRouter,
  // Fase 2 — Bridge ECE↔HIS (Stream 22b)
  eceBridgeEncounter: bridgeEncounterRouter,
  // Fase 2 — Bridge ECE-HIS Triage
  eceBridgeTriage: eceBridgeTriageRouter,
  // Fase 2 — ECE Atención de Emergencia (ATN_EMERG)
  eceAtencionEmergencia: atencionEmergenciaRouter,
  // ECE — RRI (NTEC Doc 10)
  eceRri: eceRriRouter,
});

export type AppRouter = typeof appRouter;
