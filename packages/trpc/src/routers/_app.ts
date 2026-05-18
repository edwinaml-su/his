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
// ECE — Solicitud y Resultado de Estudio (Doc 18 NTEC)
import { eceSolicitudEstudioRouter } from "./ece/solicitud-estudio.router";
import { eceResultadoEstudioRouter } from "./ece/resultado-estudio.router";
// ECE — Valoración Inicial de Enfermería (one-shot al ingreso)
import { eceValoracionInicialRouter } from "./ece/valoracion-inicial-enfermeria.router";
// Fase 2 — ECE Hoja de Ingreso Hospitalario (Doc 12 NTEC)
import { eceHojaIngresoRouter } from "./ece/hoja-ingreso.router";
// ECE — Mapa de Camas
import { eceCamaRouter } from "./ece/cama.router";
// Fase 2 — ECE Episodio Hospitalario (ciclo hospitalario completo)
import { eceEpisodioHospitalarioRouter } from "./ece/episodio-hospitalario.router";
// ECE — Certificado de Defunción (NTEC Art. 21)
import { eceCertDefRouter } from "./ece/certificado-defuncion.router";
// Fase 2 — Bridge Admisión Hospitalaria
import { eceBridgeAdmisionRouter } from "./ece/bridge-admision.router";
// ECE — Lista de Verificación Preoperatoria (NTEC Art. 28)
import { eceCirugiaPreopRouter } from "./ece/preop-checklist.router";
// ECE — WHO Surgical Safety Checklist (OMS Cirugía Segura 2009)
import { eceWhoChecklistRouter } from "./ece/who-checklist.router";
// ECE — Registro Anestésico Intraoperatorio (REG_ANEST)
import { eceRegistroAnestesicoRouter } from "./ece/registro-anestesico.router";
// ECE — URPA (Recuperación Post-Anestésica)
import { eceUrpaRecoveryRouter } from "./ece/urpa-recovery.router";
// Fase 2 — Bridge Cirugía Quirúrgica (ECE — Quirófano)
import { eceBridgeCirugiaRouter } from "./ece/bridge-cirugia.router";
// ECE — Partograma OMS (NTEC Doc 14)
import { ecePartogramaRouter } from "./ece/partograma.router";
// ECE — Atención Recién Nacido (NTEC Doc ATN_RN)
import { eceAtencionRnRouter } from "./ece/atencion-rn.router";
// ECE — Maternidad: Reanimación Neonatal NRP (AHA/AAP)
import { eceReanimacionNeonatalRouter } from "./ece/reanimacion-neonatal.router";
// ECE — Período Expulsivo + Alumbramiento (NTEC Doc 14)
import { periodoExpulsivoRouter } from "./ece/periodo-expulsivo.router";
// Fase 2 (S7) — GS1 Logística: Proceso A Inbound
import { gs1ProcesoARouter } from "./gs1-proceso-a.router";
// GS1 Logística — Proceso B (Transferencias entre depósitos)
import { gs1ProcesoBRouter } from "./gs1-proceso-b.router";
// Proceso C GS1 — Preparación Unidosis
import { gs1ProcesoCRouter } from "./gs1-proceso-c.router";
// GS1 — Proceso F: Logística inversa devoluciones
import { gs1ProcesoFRouter } from "./gs1-proceso-f.router";
// GS1 Logística — EPCIS Query Layer (schema legacy)
import { epcisQueryRouter } from "./epcis-query.router";
// F2-S15 placeholder — Cold Chain Monitoring
import { coldChainRouter } from "./cold-chain.router";
// GS1 Healthcare Standards
import { gs1CatalogosRouter } from "./gs1-catalogos.router";
// Fase 2 — S7: Algoritmo 5 Correctos bedside (US.F2.6.21-22)
import { bedsideRouter } from "./bedside.router";
// Fase 2 (S7) — Sustitución genérico-comercial autorizada (US.F2.6.11)
import { pharmacySubstitutionRouter } from "./pharmacy/substitution.router";
// Fase 2 — F2-S7: Estación de Picking Farmacia (US.F2.6.6-7)
import { dispensationRouter } from "./pharmacy/dispensation.router";
import { glnHierarchyRouter } from "./gs1-gln-hierarchy.router";
import { gs1MedicationRouter } from "./gs1-medication.router";
import { gs1DashboardRouter } from "./gs1-dashboard.router";
// ECE — Acto Quirúrgico (NTEC §3.13 / Doc 13)
import { eceActoQuirurgicoRouter } from "./ece/acto-quirurgico.router";
// ECE — Sala de Expulsión (Doc 14 NTEC)
import { eceSalaExpulsionRouter } from "./ece/sala-expulsion.router";
// Fase 2 S7 — GS1 Bedside: GSRN Pulsera Paciente (US.F2.6.1)
import { gsrnPulseraRouter } from "./pharmacy/gsrn-pulsera.router";
// Fase 2 — S7: Catálogo GSRN Profesionales (US.F2.6.2)
import { staffGsrnRouter } from "./staff-gsrn.router";
// F2-S7 — Carrito Unidosis (US.F2.6.12-16)
import { cartRouter } from "./pharmacy/cart.router";
// Fase 2 — Bedside PWA (US.F2.6.23-26)
import { bedsideRouter } from "./bedside.router";

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
  // ECE — Solicitud y Resultado de Estudio (Doc 18 NTEC)
  eceSolicitudEstudio: eceSolicitudEstudioRouter,
  eceResultadoEstudio: eceResultadoEstudioRouter,
  // ECE — Valoración Inicial de Enfermería
  eceValoracionInicial: eceValoracionInicialRouter,
  // Fase 2 — ECE Hoja de Ingreso Hospitalario (Doc 12 NTEC)
  eceHojaIngreso: eceHojaIngresoRouter,
  // ECE — Mapa de Camas
  eceCama: eceCamaRouter,
  // Fase 2 — ECE Episodio Hospitalario (ciclo hospitalario completo)
  eceEpisodioHospitalario: eceEpisodioHospitalarioRouter,
  // ECE — Certificado de Defunción (NTEC Art. 21)
  eceCertDef: eceCertDefRouter,
  // Fase 2 — Bridge Admisión Hospitalaria
  eceBridgeAdmision: eceBridgeAdmisionRouter,
  // ECE — Lista de Verificación Preoperatoria (NTEC Art. 28)
  eceCirugiaPreop: eceCirugiaPreopRouter,
  // ECE — WHO Surgical Safety Checklist
  eceWhoChecklist: eceWhoChecklistRouter,
  // ECE — Registro Anestésico Intraoperatorio
  eceRegistroAnestesico: eceRegistroAnestesicoRouter,
  // ECE — URPA (Recuperación Post-Anestésica)
  eceUrpa: eceUrpaRecoveryRouter,
  // Fase 2 — Bridge Cirugía Quirúrgica (ECE — Quirófano)
  eceBridgeCirugia: eceBridgeCirugiaRouter,
  // ECE — Partograma OMS (NTEC Doc 14)
  ecePartograma: ecePartogramaRouter,
  // ECE — Atención Recién Nacido (NTEC Doc ATN_RN)
  eceAtencionRn: eceAtencionRnRouter,
  // ECE — Maternidad: Reanimación Neonatal NRP
  eceReanimacionNeonatal: eceReanimacionNeonatalRouter,
  // ECE — Período Expulsivo + Alumbramiento (NTEC Doc 14)
  ecePeriodoExpulsivo: periodoExpulsivoRouter,
  // Fase 2 (S7) — GS1 Logística: Proceso A Inbound
  gs1ProcesoA: gs1ProcesoARouter,
  // GS1 Logística — Proceso B (Transferencias entre depósitos GLN)
  gs1ProcesoB: gs1ProcesoBRouter,
  // Proceso C GS1 — Preparación Unidosis
  gs1ProcesoC: gs1ProcesoCRouter,
  // GS1 — Proceso F: Logística inversa devoluciones
  gs1ProcesoF: gs1ProcesoFRouter,
  // GS1 Logística — EPCIS Query Layer
  epcisQuery: epcisQueryRouter,
  // F2-S15 placeholder — Cold Chain Monitoring
  coldChain: coldChainRouter,
  // GS1 Healthcare Standards
  gs1: gs1CatalogosRouter,
  // Fase 2 — S7: Algoritmo 5 Correctos bedside (US.F2.6.21-22)
  bedside: bedsideRouter,
  // Fase 2 (S7) — Sustitución genérico-comercial (US.F2.6.11)
  pharmacySubstitution: pharmacySubstitutionRouter,
  // Fase 2 — F2-S7: Estación de Picking Farmacia (US.F2.6.6-7)
  dispensation: dispensationRouter,
  // GS1 — US.F2.6.3-5: GLN hierarchy, medicamentos extendidos, dashboard
  gs1GlnHierarchy: glnHierarchyRouter,
  gs1Medication: gs1MedicationRouter,
  gs1Dashboard: gs1DashboardRouter,
  // ECE — Acto Quirúrgico (NTEC §3.13 / Doc 13)
  eceActoQx: eceActoQuirurgicoRouter,
  // ECE — Sala de Expulsión (Doc 14 NTEC)
  eceSalaExpulsion: eceSalaExpulsionRouter,
  // Fase 2 S7 — GS1 Bedside: GSRN Pulsera Paciente (US.F2.6.1)
  gsrnPulsera: gsrnPulseraRouter,
  // Fase 2 — S7: Catálogo GSRN Profesionales (US.F2.6.2)
  staffGsrn: staffGsrnRouter,
  // F2-S7 — Carrito Unidosis (US.F2.6.12-16)
  pharmacyCart: cartRouter,
  // Fase 2 — Bedside PWA (US.F2.6.23-26)
  bedside: bedsideRouter,
});

export type AppRouter = typeof appRouter;
