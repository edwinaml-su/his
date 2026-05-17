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
import { workflowTipoDocRouter } from "./workflow-tipoDoc.router";
import { workflowEstadoRouter } from "./workflow-estado.router";
import { workflowInstanceRouter } from "./workflow-instance.router";

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
  workflowTipoDoc: workflowTipoDocRouter,
  workflowEstado: workflowEstadoRouter,
  workflowInstance: workflowInstanceRouter,
});

export type AppRouter = typeof appRouter;
