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
import { lisRouter } from "./lis.router";
import { auditIntegrityRouter } from "./audit-integrity.router";
import { censusRouter } from "./census.router";
import { deathCertificateRouter } from "./death-certificate.router";
import { ehrNotesRouter } from "./ehr-notes.router";
import { encounterDischargeRouter } from "./encounter-discharge.router";
import { encounterTransferRouter } from "./encounter-transfer.router";
import { newbornRouter } from "./newborn.router";
import { outpatientRouter } from "./outpatient.router";
import { patientHistoryRouter } from "./patient-history.router";
import { pharmacyRouter } from "./pharmacy.router";
import { triageDashboardRouter } from "./triage-dashboard.router";
import { triageFlowchartRouter } from "./triage-flowchart.router";
import { triageRetriageRouter } from "./triage-retriage.router";
import { sloRouter } from "./slo.router";
import { vaccinationRouter } from "./vaccination.router";
import { allergyRouter } from "./allergy.router";
import { problemListRouter } from "./problem-list.router";
import { soapTemplateRouter } from "./soap-template.router";
import { gsrnPulseraRouter } from "./pharmacy/gsrn-pulsera.router";
import { patientIdentificationRouter } from "./patient-identification.router";

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
  lis: lisRouter,
  auditIntegrity: auditIntegrityRouter,
  census: censusRouter,
  deathCertificate: deathCertificateRouter,
  ehrNote: ehrNotesRouter,
  encounterDischarge: encounterDischargeRouter,
  encounterTransfer: encounterTransferRouter,
  newborn: newbornRouter,
  outpatient: outpatientRouter,
  patientHistory: patientHistoryRouter,
  pharmacy: pharmacyRouter,
  triageDashboard: triageDashboardRouter,
  triageFlowchart: triageFlowchartRouter,
  triageRetriage: triageRetriageRouter,
  slo: sloRouter,
  vaccination: vaccinationRouter,
  /** Wave 1 cont. · Bravo */
  allergy: allergyRouter,
  problemList: problemListRouter,
  soapTemplate: soapTemplateRouter,
  /** Fase 2 S7 — GS1 Bedside (US.F2.6.1) */
  gsrnPulsera: gsrnPulseraRouter,
  // US.F2.6.37-40 — Identificación paciente por pulsera GSRN
  patientIdentification: patientIdentificationRouter,
});

export type AppRouter = typeof appRouter;
