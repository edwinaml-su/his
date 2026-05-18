import { z } from "zod";

/**
 * Payload schemas por eventType — Beta.15.
 *
 * Cada nuevo eventType registrado en `catalog.ts` DEBE añadir aquí su payload
 * schema + entry en `domainEventPayloadSchema` (discriminated union).
 *
 * Estos schemas se validan en `emitDomainEvent` ANTES del INSERT a
 * `DomainEvent`. Si el payload no matchea el shape declarado, se lanza
 * `ZodError` que el router debe propagar (no swallow).
 *
 * Ver:
 *  - Blueprint §3.2 (`docs/blueprints/beta15_notifications.md`)
 *  - DBA review §S2.5 (validación BD: CHECK `jsonb_typeof = 'object'`,
 *    el resto se enforza en TS).
 */

// -----------------------------------------------------------------------------
// vital.critical
// -----------------------------------------------------------------------------

/** Parámetros vitales que el motor `vital-alerts.ts` puede flaggar. */
export const vitalAlertParameterSchema = z.enum([
  "SPO2",
  "HR",
  "BP_SYS",
  "BP_DIA",
  "TEMP",
  "GCS",
  "PAIN",
  "RR",
  "ETCO2",
]);

export const vitalAlertSeveritySchema = z.enum(["CRITICAL", "WARNING"]);

export const vitalAlertItemSchema = z.object({
  parameter: vitalAlertParameterSchema,
  value: z.number(),
  severity: vitalAlertSeveritySchema,
  /** Texto humanamente legible — usado en subject de email + cuerpo del inbox. */
  message: z.string().min(1).max(200),
});

export const vitalCriticalPayloadSchema = z.object({
  /** Origen del vital. Puede provenir de InpatientVitals o VentilatorSession. */
  source: z.enum(["InpatientVitals", "VentilatorSession"]),
  /** Sólo presente si source = InpatientVitals. */
  admissionId: z.string().uuid().optional(),
  /** Sólo presente si source = VentilatorSession. */
  respiratoryOrderId: z.string().uuid().optional(),
  patientId: z.string().uuid(),
  /** id de la fila origen (InpatientVitals.id ó VentilatorSession.id). */
  sourceRowId: z.string().uuid(),
  alerts: z.array(vitalAlertItemSchema).min(1),
});

// -----------------------------------------------------------------------------
// lab.criticalValue
// -----------------------------------------------------------------------------

export const labFlagSchema = z.enum([
  "NORMAL",
  "LOW",
  "HIGH",
  "CRITICAL_LOW",
  "CRITICAL_HIGH",
  "ABNORMAL",
]);

export const labCriticalValuePayloadSchema = z.object({
  orderItemId: z.string().uuid(),
  resultId: z.string().uuid(),
  /** prescriberId desde LabOrder; receptor canónico de la alerta. */
  prescriberId: z.string().uuid(),
  /** LOINC u otro código del test. */
  testCode: z.string().min(1).max(40),
  /** Sólo emitido cuando flag ∈ {CRITICAL_LOW, CRITICAL_HIGH}. */
  flag: z.enum(["CRITICAL_LOW", "CRITICAL_HIGH"]),
  value: z.number(),
  unit: z.string().max(40).optional(),
  referenceRange: z.object({
    low: z.number().nullable(),
    high: z.number().nullable(),
  }),
});

// -----------------------------------------------------------------------------
// drug.interaction
// -----------------------------------------------------------------------------

export const drugInteractionPayloadSchema = z.object({
  prescriptionId: z.string().uuid(),
  prescriberId: z.string().uuid(),
  /** Mínimo 2 drogas en conflicto (la nueva + la preexistente). */
  conflictingDrugIds: z.array(z.string().uuid()).min(2),
  severity: vitalAlertSeveritySchema, // mismo enum CRITICAL/WARNING
  description: z.string().min(1).max(500),
});

// -----------------------------------------------------------------------------
// allergy.mismatch
// -----------------------------------------------------------------------------

export const allergyMismatchPayloadSchema = z.object({
  /** Una de las dos formas de origen: prescription o eMAR administration. */
  prescriptionItemId: z.string().uuid().optional(),
  medicationAdministrationId: z.string().uuid().optional(),
  patientId: z.string().uuid(),
  allergyId: z.string().uuid(),
  drugId: z.string().uuid(),
  /** prescriberId puede ser null en eMAR si la alergia se detecta en admin. */
  prescriberId: z.string().uuid().nullable(),
});

// transfusion.crossmatchFailed  (Beta.16)
// -----------------------------------------------------------------------------

export const transfusionCrossmatchFailedPayloadSchema = z.object({
  requestId: z.string().uuid(),
  unitId: z.string().uuid(),
  crossMatchId: z.string().uuid(),
  result: z.enum(["INCOMPATIBLE", "INCONCLUSIVE"]),
  /** UUID del médico solicitante — receptor primario de la alerta. */
  requestedById: z.string().uuid(),
  patientId: z.string().uuid(),
});

// -----------------------------------------------------------------------------
// transfusion.adverseReaction  (Beta.16)
// -----------------------------------------------------------------------------

export const adverseReactionSeveritySchema = z.enum(["MILD", "MODERATE", "SEVERE", "LIFE_THREATENING"]);

export const transfusionAdverseReactionPayloadSchema = z.object({
  transfusionId: z.string().uuid(),
  requestId: z.string().uuid(),
  patientId: z.string().uuid(),
  /** UUID del médico supervisor de la transfusión. */
  supervisorId: z.string().uuid(),
  /** UUID del enfermero que registró la reacción. */
  nurseId: z.string().uuid(),
  reactionType: z.string().min(1).max(120),
  severity: adverseReactionSeveritySchema,
});

// -----------------------------------------------------------------------------
// pathology.reportSigned / pathology.criticalFinding (Beta.17)
// -----------------------------------------------------------------------------

export const pathologyReportSignedPayloadSchema = z.object({
  reportId: z.string().uuid(),
  orderId: z.string().uuid(),
  /** prescriberId = médico solicitante; receptor canónico del evento. */
  requestingPhysicianId: z.string().uuid(),
  pathologistId: z.string().uuid(),
  primaryDiagnosis: z.string().min(1).max(1000),
});

export const pathologyCriticalFindingPayloadSchema = z.object({
  reportId: z.string().uuid(),
  orderId: z.string().uuid(),
  /** Receptor canónico: médico solicitante. */
  requestingPhysicianId: z.string().uuid(),
  /** Jefe de servicio (si el router lo resuelve; opcional Beta.17). */
  serviceHeadId: z.string().uuid().optional(),
  primaryDiagnosis: z.string().min(1).max(1000),
});

// -----------------------------------------------------------------------------
// accounting.periodClosed  (Beta.18)
// -----------------------------------------------------------------------------

export const accountingPeriodClosedPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  ledgerId:       z.string().uuid(),
  periodId:       z.string().uuid(),
  periodYear:     z.number().int(),
  periodMonth:    z.number().int().min(0).max(12),
  closedById:     z.string().uuid(),
});

// -----------------------------------------------------------------------------
// accounting.journalPostedHighValue  (Beta.18)
// -----------------------------------------------------------------------------

export const accountingJournalPostedHighValuePayloadSchema = z.object({
  organizationId:    z.string().uuid(),
  ledgerId:          z.string().uuid(),
  journalEntryId:    z.string().uuid(),
  totalDebit:        z.number(),
  thresholdExceeded: z.number(),
  postedById:        z.string().uuid(),
});

// -----------------------------------------------------------------------------
// nutrition.allergyOverride  (UAT-BUG-02)
// Emitido cuando un médico autoriza explícitamente un plan dietético que
// contiene alergenos del paciente, con razón documentada y consentimiento.
// -----------------------------------------------------------------------------

export const nutritionAllergyOverridePayloadSchema = z.object({
  nutritionOrderId: z.string().uuid(),
  patientId: z.string().uuid(),
  dietPlanId: z.string().uuid(),
  /** Alergenos en conflicto (valores de DietPlan.allergens que intersectaron). */
  conflictingAllergens: z.array(z.string().min(1)).min(1),
  /** Razón clínica documentada para el override. */
  reason: z.string().min(1).max(1000),
  /** Nombre o ID del profesional que autorizó el override. */
  acknowledgedBy: z.string().min(1).max(200),
  prescriberId: z.string().uuid(),
});

export type NutritionAllergyOverridePayload = z.infer<
  typeof nutritionAllergyOverridePayloadSchema
>;

// -----------------------------------------------------------------------------
// workflow.transitionExecuted  (Fase 2 — Motor Workflow ECE, Stream 15)
// Emitido después de cada avance exitoso de estado en ece.documento_instancia.
// -----------------------------------------------------------------------------

export const workflowTransitionExecutedPayloadSchema = z.object({
  instanceId: z.string().uuid(),
  tipoDocumentoCodigo: z.string().min(1).max(64),
  fromStateId: z.string().uuid(),
  toStateId: z.string().uuid(),
  accion: z.string().min(1).max(128),
  byUserId: z.string().uuid(),
  firmaId: z.string().uuid().optional(),
});

export type WorkflowTransitionExecutedPayload = z.infer<
  typeof workflowTransitionExecutedPayloadSchema
>;

// -----------------------------------------------------------------------------
// ece.triaje.firmado  (Fase 2 — ECE Triaje NTEC, Stream 02)
// Emitido cuando ENF firma la hoja de triaje ECE.
// -----------------------------------------------------------------------------

export const eceTriajeFirmadoPayloadSchema = z.object({
  hojaTriajeId: z.string().uuid(),
  instanciaId: z.string().uuid(),
  episodioId: z.string().uuid(),
  manchesterNivel: z.number().int().min(1).max(5),
  firmadoPorId: z.string().uuid(),
});

export type EceTriajeFirmadoPayload = z.infer<typeof eceTriajeFirmadoPayloadSchema>;
// ece.indicaciones.firmadas  (Fase 2 — IND_MED ECE)
// Emitido cuando MC firma una indicación médica (borrador|en_revision → firmado).
// -----------------------------------------------------------------------------

export const eceIndicacionesFirmadasPayloadSchema = z.object({
  indicacionId: z.string().uuid(),
  episodioId: z.string().uuid(),
  firmadoPor: z.string().uuid(),
  estadoAnterior: z.string().min(1).max(50),
});

export type EceIndicacionesFirmadasPayload = z.infer<
  typeof eceIndicacionesFirmadasPayloadSchema
>;

// -----------------------------------------------------------------------------
// ece.administracion.registrada  (Fase 2 — ECE Registro Enfermería, Stream 30)
// Emitido cuando se agrega una fila a ece.administracion_medicamento.
// -----------------------------------------------------------------------------

export const eceAdministracionRegistradaPayloadSchema = z.object({
  administracionId: z.string().uuid(),
  registroId: z.string().uuid(),
  indicacionItemId: z.string().uuid(),
  episodioId: z.string().uuid(),
  enfermeraId: z.string().uuid(),
});

export type EceAdministracionRegistradaPayload = z.infer<
  typeof eceAdministracionRegistradaPayloadSchema
>;
// ece.evolucion.firmada  (Fase 2 — ECE Evolución Médica, Stream 11)
// Emitido cuando un MC/MT firma una evolución médica.
// -----------------------------------------------------------------------------

export const eceEvolucionFirmadaPayloadSchema = z.object({
  evolucionId: z.string().uuid(),
  episodioId: z.string().uuid(),
  firmadaPor: z.string().uuid(),
  /** SHA-256 hex del payload SOAP concatenado (subjetivo||objetivo||analisis||plan). */
  contentHash: z.string().length(64),
  firmadaEn: z.string().datetime(),
});

export type EceEvolucionFirmadaPayload = z.infer<typeof eceEvolucionFirmadaPayloadSchema>;
// ece.epicrisis.certificada  (Fase 2 — ECE §3.15, Art. 21)
// Emitido cuando el Director certifica la epicrisis de egreso.
// -----------------------------------------------------------------------------

export const eceEpicrisisCertificadaPayloadSchema = z.object({
  epicrisisId: z.string().uuid(),
  episodioId: z.string().uuid(),
  /** Hash SHA-256 del documento de epicrisis en el momento de certificación. */
  documentHash: z.string().min(64).max(64),
  /** userId del Director que certifica (Art. 21). */
  directorId: z.string().uuid(),
  firmaId: z.string().uuid(),
  organizationId: z.string().uuid(),
});

export type EceEpicrisisCertificadaPayload = z.infer<typeof eceEpicrisisCertificadaPayloadSchema>;
// ece.documento.certificado  (Fase 2 — Certificación DIR, Art. 21 NTEC)
// Emitido cuando el Director certifica formalmente una instancia de documento
// (FICHA_ID, EPICRISIS o CERT_DEF) avanzando su estado a 'certificado'.
// -----------------------------------------------------------------------------

export const eceDocumentoCertificadoPayloadSchema = z.object({
  instanciaId: z.string().uuid(),
  tipoDocumentoCodigo: z.string().min(1).max(64),
  /** Estado anterior (debe ser 'validado'). */
  fromEstadoCodigo: z.string().min(1).max(64),
  /** UUID de la fila ece.firma_electronica del DIR. */
  firmaId: z.string().uuid(),
  /** SHA-256 del payload clínico serializado (para cadena de integridad). */
  payloadHash: z.string().length(64),
  /** UUID del usuario DIR que certifica. */
  dirUserId: z.string().uuid(),
  pacienteId: z.string().uuid(),
});

export type EceDocumentoCertificadoPayload = z.infer<
  typeof eceDocumentoCertificadoPayloadSchema
>;
// ece.paciente.linked  (Fase 2 — bridge ECE↔HIS)
// Emitido cuando se establece el vínculo ece.paciente ↔ public.Patient.
// -----------------------------------------------------------------------------

export const ecePacienteLinkedPayloadSchema = z.object({
  ecePacienteId: z.string().uuid(),
  publicPatientId: z.string().uuid(),
  linkedById: z.string().uuid(),
  organizationId: z.string().uuid(),
});

// -----------------------------------------------------------------------------
// ece.paciente.synced  (Fase 2 — bridge ECE↔HIS)
// Emitido tras sincronización de campos demográficos NTEC Art. 15 en cualquier
// dirección (fromHis | toHis).
// -----------------------------------------------------------------------------

export const ecePacienteSyncedPayloadSchema = z.object({
  ecePacienteId: z.string().uuid(),
  publicPatientId: z.string().uuid(),
  direction: z.enum(["fromHis", "toHis"]),
  syncedById: z.string().uuid(),
  organizationId: z.string().uuid(),
  fieldsUpdated: z.array(z.string().min(1)).min(1),
});

export type EcePacienteLinkedPayload = z.infer<typeof ecePacienteLinkedPayloadSchema>;
export type EcePacienteSyncedPayload = z.infer<typeof ecePacienteSyncedPayloadSchema>;
// ece.episodio.linkedToEncounter  (Fase 2 — Bridge ECE↔HIS, Stream 22b)
// Emitido cuando un episodio ECE se vincula (o crea) desde un Encounter HIS.
// -----------------------------------------------------------------------------

export const eceEpisodioLinkedToEncounterPayloadSchema = z.object({
  episodioId: z.string().uuid(),
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  organizationId: z.string().uuid(),
  /** Quién ejecutó la operación — puede ser null para vínculos automáticos. */
  linkedById: z.string().uuid().nullable(),
});

export type EceEpisodioLinkedToEncounterPayload = z.infer<
  typeof eceEpisodioLinkedToEncounterPayloadSchema
>;

// -----------------------------------------------------------------------------
// ece.triaje.linkedToHisTriage  (Fase 2 — Bridge ECE-HIS, Stream 18-ext)
// Emitido cuando una EceTriaje queda vinculada a una TriageEvaluation HIS.
// -----------------------------------------------------------------------------

export const eceTriajeLinkedToHisTriagePayloadSchema = z.object({
  /** UUID de la TriageEvaluation HIS (public.TriageEvaluation). */
  hisTriageId: z.string().uuid(),
  /** UUID de la EceTriaje (ece.triaje). */
  eceTriajeId: z.string().uuid(),
  /** UUID del paciente HIS. */
  patientId: z.string().uuid(),
  /** Nivel Manchester 1-5 mapeado al nivelPrioridad ECE. */
  manchesterLevel: z.number().int().min(1).max(5),
  /** true si el triajista firmó electrónicamente en el mismo acto. */
  firmadoInmediatamente: z.boolean(),
  /** UUID del profesional que ejecutó la operación. */
  byUserId: z.string().uuid(),
});

export type EceTriajeLinkedToHisTriagePayload = z.infer<
  typeof eceTriajeLinkedToHisTriagePayloadSchema
>;

// -----------------------------------------------------------------------------
// ece.episodio.abierto / ece.episodio.cerrado (Fase 2 — Episodio de atención)
// Emitidos al abrir un episodio (ambulatorio u hospitalario) y al cerrarlo.
// -----------------------------------------------------------------------------

export const eceEpisodioAbiertoPayloadSchema = z.object({
  /** UUID del episodio (ece.episodio_atencion). */
  episodioId: z.string().uuid(),
  /** UUID del paciente ECE (ece.paciente). */
  ecePacienteId: z.string().uuid(),
  /** Modalidad del episodio. */
  modalidad: z.enum(["ambulatorio", "hospitalario"]),
  /** Fecha/hora de apertura. */
  fechaApertura: z.string(),
  /** UUID del profesional que abrió el episodio. */
  byUserId: z.string().uuid(),
  /** UUID del Encounter HIS si fue creado desde uno (opcional). */
  encounterId: z.string().uuid().optional(),
});

export type EceEpisodioAbiertoPayload = z.infer<typeof eceEpisodioAbiertoPayloadSchema>;

export const eceEpisodioCerradoPayloadSchema = z.object({
  /** UUID del episodio (ece.episodio_atencion). */
  episodioId: z.string().uuid(),
  /** UUID del paciente ECE. */
  ecePacienteId: z.string().uuid(),
  /** Fecha/hora de cierre. */
  fechaCierre: z.string(),
  /** Motivo de cierre (alta, transferencia, cancelación). */
  motivo: z.string().min(1).max(200).optional(),
  /** UUID del profesional que cerró el episodio. */
  byUserId: z.string().uuid(),
});

export type EceEpisodioCerradoPayload = z.infer<typeof eceEpisodioCerradoPayloadSchema>;

// -----------------------------------------------------------------------------
// ece.atencion_emergencia.firmada  (Fase 2 — NTEC Doc 5, ATN_EMERG)
// Emitido cuando el MT firma una atención de emergencia (borrador|en_revision → firmado).
// -----------------------------------------------------------------------------

export const eceAtencionEmergenciaFirmadaPayloadSchema = z.object({
  atencionId: z.string().uuid(),
  episodioId: z.string().uuid(),
  /** SHA-256 hex del payload clínico concatenado. */
  contentHash: z.string().length(64),
  firmadoPor: z.string().uuid(),
  firmadaEn: z.string().datetime(),
  organizationId: z.string().uuid(),
});

export type EceAtencionEmergenciaFirmadaPayload = z.infer<
  typeof eceAtencionEmergenciaFirmadaPayloadSchema
>;

// -----------------------------------------------------------------------------
// ece.rri.firmada / ece.rri.respondida  (Fase 2 — NTEC Doc 10, RRI)
// Emitidos cuando MC firma una RRI (en_revision → firmado) y cuando IC/MC/ESP
// responde (firmado → validado).
// -----------------------------------------------------------------------------

export const eceRriFirmadaPayloadSchema = z.object({
  instanceId: z.string().uuid(),
  tipo: z.string().min(1).max(64),
  urgencia: z.string().min(1).max(64),
  destinoServicioId: z.string().uuid().nullable().optional(),
  solicitadoPor: z.string().uuid(),
  payloadHash: z.string().length(64),
  firmaId: z.string().uuid(),
});

export type EceRriFirmadaPayload = z.infer<typeof eceRriFirmadaPayloadSchema>;

export const eceRriRespondidaPayloadSchema = z.object({
  instanceId: z.string().uuid(),
  tipo: z.string().min(1).max(64),
  respondidoPor: z.string().uuid(),
  firmaId: z.string().uuid(),
});

export type EceRriRespondidaPayload = z.infer<typeof eceRriRespondidaPayloadSchema>;

// -----------------------------------------------------------------------------
// ece.solicitud_estudio.{firmada,validada,anulada}  (Fase 2 — NTEC Doc 18)
// -----------------------------------------------------------------------------

export const eceSolicitudEstudioFirmadaPayloadSchema = z.object({
  instanceId: z.string().uuid(),
  tipoDocumentoCodigo: z.string().min(1).max(64),
  tipo: z.string().min(1).max(64),
  prioridad: z.string().min(1).max(64),
  accion: z.string().min(1).max(64),
  byUserId: z.string().uuid(),
  firmaId: z.string().uuid(),
});

export type EceSolicitudEstudioFirmadaPayload = z.infer<
  typeof eceSolicitudEstudioFirmadaPayloadSchema
>;

export const eceSolicitudEstudioValidadaPayloadSchema = z.object({
  instanceId: z.string().uuid(),
  tipoDocumentoCodigo: z.string().min(1).max(64),
  accion: z.string().min(1).max(64),
  byUserId: z.string().uuid(),
  observacion: z.string().nullable().optional(),
});

export type EceSolicitudEstudioValidadaPayload = z.infer<
  typeof eceSolicitudEstudioValidadaPayloadSchema
>;

export const eceSolicitudEstudioAnuladaPayloadSchema = z.object({
  instanceId: z.string().uuid(),
  accion: z.string().min(1).max(64),
  motivo: z.string().min(1).max(500),
  byUserId: z.string().uuid(),
});

export type EceSolicitudEstudioAnuladaPayload = z.infer<
  typeof eceSolicitudEstudioAnuladaPayloadSchema
>;

// -----------------------------------------------------------------------------
// ece.resultado_estudio.{registrado,aprobado}  (Fase 2 — NTEC Doc 18)
// -----------------------------------------------------------------------------

export const eceResultadoEstudioRegistradoPayloadSchema = z.object({
  solicitudId: z.string().uuid(),
  instanceId: z.string().uuid(),
  byUserId: z.string().uuid(),
});

export type EceResultadoEstudioRegistradoPayload = z.infer<
  typeof eceResultadoEstudioRegistradoPayloadSchema
>;

export const eceResultadoEstudioAprobadoPayloadSchema = z.object({
  solicitudId: z.string().uuid(),
  byUserId: z.string().uuid(),
  comentarioMedico: z.string().nullable().optional(),
});

export type EceResultadoEstudioAprobadoPayload = z.infer<
  typeof eceResultadoEstudioAprobadoPayloadSchema
>;
// ece.hoja_ingreso.firmada / ece.hoja_ingreso.validada (Fase 2 — Doc 12 NTEC)
// Emitidos cuando el ADM firma (borrador→firmado) y cuando ARCH valida.
// -----------------------------------------------------------------------------

export const eceHojaIngresoFirmadaPayloadSchema = z.object({
  hojaIngresoId: z.string().uuid(),
  instanciaId: z.string().uuid(),
  tipoDocumentoCodigo: z.literal("HOJA_ING"),
  accion: z.literal("firmar"),
  byUserId: z.string().uuid(),
  firmaId: z.string().uuid(),
  /** SHA-256 hex del payload clínico en el momento de la firma. */
  payloadHash: z.string().length(64),
});

export const eceHojaIngresoValidadaPayloadSchema = z.object({
  hojaIngresoId: z.string().uuid(),
  instanciaId: z.string().uuid(),
  tipoDocumentoCodigo: z.literal("HOJA_ING"),
  accion: z.literal("validar"),
  byUserId: z.string().uuid(),
  observacion: z.string().max(1000).nullable(),
  payloadHash: z.string().length(64),
});

export type EceHojaIngresoFirmadaPayload = z.infer<typeof eceHojaIngresoFirmadaPayloadSchema>;
export type EceHojaIngresoValidadaPayload = z.infer<typeof eceHojaIngresoValidadaPayloadSchema>;
// ece.admision.completada (Fase 2 — Bridge Admisión Hospitalaria)
// Emitido cuando ADM ejecuta la admisión completa desde una orden de ingreso.
// Crea atómicamente: episodio + episodio_hospitalario + hoja_ingreso + (cama).
// -----------------------------------------------------------------------------

export const eceAdmisionCompletadaPayloadSchema = z.object({
  /** UUID del episodio_atencion creado. */
  episodioId: z.string().uuid(),
  /** UUID del episodio_hospitalario creado. */
  episodioHospitalarioId: z.string().uuid(),
  /** UUID de la hoja_ingreso creada. */
  hojaIngresoId: z.string().uuid(),
  /** UUID de la orden_ingreso que originó la admisión. */
  ordenIngresoId: z.string().uuid(),
  /** UUID del paciente ECE. */
  ecePacienteId: z.string().uuid(),
  /** UUID de la cama asignada, si se asignó una. */
  camaAsignadaId: z.string().uuid().optional(),
  /** UUID del ADM que ejecutó la admisión. */
  admisionPorId: z.string().uuid(),
  /** Organización (tenant). */
  organizationId: z.string().uuid(),
});

export type EceAdmisionCompletadaPayload = z.infer<typeof eceAdmisionCompletadaPayloadSchema>;

// -----------------------------------------------------------------------------
// ece.valoracion_inicial.firmada (Fase 2 S4 — NTEC §4)
// -----------------------------------------------------------------------------

export const eceValoracionInicialFirmadaPayloadSchema = z.object({
  valoracionId: z.string().uuid(),
  episodioHospitalarioId: z.string().uuid(),
  enfermeraId: z.string().uuid(),
});

export type EceValoracionInicialFirmadaPayload = z.infer<
  typeof eceValoracionInicialFirmadaPayloadSchema
>;

// -----------------------------------------------------------------------------
// ece.episodio.altaIniciada / altaConfirmada (Fase 2 S4 — wizard alta médica)
// -----------------------------------------------------------------------------

export const eceEpisodioAltaIniciadaPayloadSchema = z.object({
  episodioId: z.string().uuid(),
  epicrisisId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  medicoAltaId: z.string().uuid(),
  motivoAlta: z.string(),
  fechaHoraAlta: z.string(),
});

export type EceEpisodioAltaIniciadaPayload = z.infer<
  typeof eceEpisodioAltaIniciadaPayloadSchema
>;

export const eceEpisodioAltaConfirmadaPayloadSchema = z.object({
  episodioId: z.string().uuid(),
  epicrisisId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  cerradoPor: z.string().uuid(),
});

export type EceEpisodioAltaConfirmadaPayload = z.infer<
  typeof eceEpisodioAltaConfirmadaPayloadSchema
>;

// -----------------------------------------------------------------------------
// ece.certificado_defuncion.firmado / .certificado (Fase 2 S4 — NTEC Doc 13)
// -----------------------------------------------------------------------------

export const eceCertificadoDefuncionFirmadoPayloadSchema = z.object({
  certDefId: z.string().uuid(),
  episodioId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  payloadHash: z.string(),
  medicoId: z.string().uuid(),
});

export type EceCertificadoDefuncionFirmadoPayload = z.infer<
  typeof eceCertificadoDefuncionFirmadoPayloadSchema
>;

export const eceCertificadoDefuncionCertificadoPayloadSchema = z.object({
  certDefId: z.string().uuid(),
  episodioId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  payloadHash: z.string(),
  dirUserId: z.string().uuid(),
});

export type EceCertificadoDefuncionCertificadoPayload = z.infer<
  typeof eceCertificadoDefuncionCertificadoPayloadSchema
>;

// -----------------------------------------------------------------------------
// gs1.inbound.recibido  (Fase 2 S7 — GS1 Proceso A)
// Emitido cuando un operador registra la recepción de mercancía en muelle.
// -----------------------------------------------------------------------------

export const gs1InboundRecibidoPayloadSchema = z.object({
  recepcionId: z.string().uuid(),
  numeroDocumentoRecepcion: z.string().min(1),
  proveedorGln: z.string().length(13),
  establecimientoId: z.string().uuid(),
  cantidadProductos: z.number().int().nonnegative(),
  registradoPorId: z.string().uuid(),
});

export type Gs1InboundRecibidoPayload = z.infer<typeof gs1InboundRecibidoPayloadSchema>;

// -----------------------------------------------------------------------------
// gs1.inbound.rechazado  (Fase 2 S7 — GS1 Proceso A)
// Emitido cuando un supervisor rechaza una recepción pendiente.
// -----------------------------------------------------------------------------

export const gs1InboundRechazadoPayloadSchema = z.object({
  recepcionId: z.string().uuid(),
  numeroDocumentoRecepcion: z.string().min(1),
  proveedorGln: z.string().length(13),
  establecimientoId: z.string().uuid(),
  motivoRechazo: z.string().min(5),
  rechazadoPorId: z.string().uuid(),
});

export type Gs1InboundRechazadoPayload = z.infer<typeof gs1InboundRechazadoPayloadSchema>;
// gs1.unidosis.preparada / gs1.unidosis.verificada
// -----------------------------------------------------------------------------

export const gs1UnidosisPreparadaPayloadSchema = z.object({
  codigoUnidosis: z.string(),
  pacienteId: z.string().uuid(),
  indicacionId: z.string().uuid(),
  gtinOrigenId: z.string().uuid(),
  cantidadPreparada: z.number().int().positive(),
  expiryUnidosis: z.string().datetime(),
});

export const gs1UnidosisVerificadaPayloadSchema = z.object({
  codigoUnidosis: z.string(),
  pacienteId: z.string().uuid(),
  verificadoPor: z.string().uuid(),
});

export type Gs1UnidosisPreparadaPayload = z.infer<typeof gs1UnidosisPreparadaPayloadSchema>;
export type Gs1UnidosisVerificadaPayload = z.infer<typeof gs1UnidosisVerificadaPayloadSchema>;
// cold_chain.excursion (F2-S15 placeholder — sensor IoT real pendiente)
// Emitido cuando una lectura queda fuera del rango configurado.
// -----------------------------------------------------------------------------

export const coldChainExcursionPayloadSchema = z.object({
  lecturaId: z.string().uuid(),
  equipmentId: z.string().uuid(),
  organizationId: z.string().uuid(),
  temperaturaC: z.number(),
  humedadPct: z.number().optional(),
  severidad: z.enum(["WARNING", "CRITICAL"]),
  mensaje: z.string().min(1).max(500),
});

export type ColdChainExcursionPayload = z.infer<typeof coldChainExcursionPayloadSchema>;

// -----------------------------------------------------------------------------
// Fase 2 S5 — Quirófano + Obstetricia + GS1 Proceso B (schemas relaxed).
// Se usan `.passthrough()` para tolerar variaciones de campos opcionales
// que los routers puedan agregar sin requerir migración de schemas.
// -----------------------------------------------------------------------------

export const ecePreopChecklistFirmadoPayloadSchema = z.object({
  checklistId: z.string().uuid(),
  cirugiaCaseId: z.string().uuid().nullable().optional(),
  pacienteId: z.string().uuid().optional(),
  firmadoPor: z.string().uuid().optional(),
}).passthrough();

export const eceCirugiaProgramadaPayloadSchema = z.object({
  cirugiaCaseId: z.string().uuid(),
  pacienteId: z.string().uuid().optional(),
  fechaProgramada: z.string().datetime().optional(),
}).passthrough();

export const eceCirugiaCanceladaPayloadSchema = z.object({
  cirugiaCaseId: z.string().uuid(),
  motivo: z.string().optional(),
}).passthrough();

export const eceRnRegistradoPayloadSchema = z.object({
  atnRnId: z.string().uuid(),
  rnPatientId: z.string().uuid().optional(),
  madrePatientId: z.string().uuid().optional(),
  episodioObsId: z.string().uuid().optional(),
  apgar1min: z.number().int().optional(),
  apgar5min: z.number().int().optional(),
}).passthrough();

export const eceRnReanimacionRequeridaPayloadSchema = z.object({
  atnRnId: z.string().uuid(),
  rnPatientId: z.string().uuid().optional(),
  protocoloNrp: z.unknown().optional(),
}).passthrough();

export const eceRnFirmadoPayloadSchema = z.object({
  atnRnId: z.string().uuid(),
  firmadoPor: z.string().uuid().optional(),
}).passthrough();

export const ecePartogramaAlertaPayloadSchema = z.object({
  partogramaId: z.string().uuid(),
  tipoAlerta: z.string().optional(),
  severidad: z.string().optional(),
}).passthrough();

export const eceExpulsionHemorragiaPostPartoAlertaPayloadSchema = z.object({
  expulsionId: z.string().uuid(),
  pacienteId: z.string().uuid().optional(),
  perdidaSanguineaMl: z.number().optional(),
}).passthrough();

export const gs1TransferEnviadaPayloadSchema = z.object({
  transferenciaId: z.string().uuid(),
  origenGln: z.string(),
  destinoGln: z.string(),
  enviadoPor: z.string().uuid().optional(),
}).passthrough();

export const gs1TransferRecibidaRechazadaPayloadSchema = z.object({
  transferenciaId: z.string().uuid(),
  origenGln: z.string(),
  destinoGln: z.string(),
  verificadoPor: z.string().uuid().optional(),
  motivoRechazo: z.string().nullable().optional(),
}).passthrough();

export const eceAnestesiaFirmadaPayloadSchema = z.object({
  registroId: z.string().uuid(),
  actoQuirurgicoId: z.string().uuid().optional(),
  firmadoPor: z.string().uuid().optional(),
}).passthrough();
// pharmacy.substitution.proposed / authorized / rejected  (US.F2.6.11)
// -----------------------------------------------------------------------------

export const pharmacySubstitutionProposedPayloadSchema = z.object({
  substitutionId:    z.string().uuid(),
  prescriptionId:    z.string().uuid(),
  prescriptionItemId: z.string().uuid(),
  gtinOriginal:      z.string().length(14),
  gtinSustituto:     z.string().length(14),
  /** UUID del médico prescriptor al que se notifica para autorizar. */
  prescriptorUserId: z.string().uuid(),
  /** UUID del farmacéutico que propone. */
  farmaceuticoUserId: z.string().uuid(),
});

export type PharmacySubstitutionProposedPayload = z.infer<
  typeof pharmacySubstitutionProposedPayloadSchema
>;

/** Payload compartido para authorized / rejected. */
export const pharmacySubstitutionDecidedPayloadSchema = z.object({
  substitutionId:  z.string().uuid(),
  prescriptionId:  z.string().uuid(),
  gtinOriginal:    z.string().length(14),
  gtinSustituto:   z.string().length(14),
  /** UUID del médico que tomó la decisión. */
  medicoUserId:    z.string().uuid(),
  motivo:          z.string().min(1).max(1000),
});

export type PharmacySubstitutionDecidedPayload = z.infer<
  typeof pharmacySubstitutionDecidedPayloadSchema
>;
// gs1.epcis.* — EPCIS bedside events (Fase 2 S7, US.F2.6.53-58)
// -----------------------------------------------------------------------------

/** WHAT dimension: identificadores GS1 del medicamento escaneado */
export const epcisWhatSchema = z.object({
  gtin: z.string().length(14),
  lote: z.string().min(1).max(50).optional(),
  serial: z.string().min(1).max(50).optional(),
  /** vencimiento en formato YYMMDD (GS1 AI 17) o ISO 8601 date */
  vencimiento: z.string().optional(),
  /** SGTIN = gtin + serial combinado */
  sgtin: z.string().optional(),
});

/** WHERE dimension: ubicaciones GLN */
export const epcisWhereSchema = z.object({
  readPoint: z.string().length(13),  // GLN lectura
  bizLocation: z.string().length(13).optional(), // GLN ubicación de negocio
});

/** WHY dimension: business step + disposition + bizTransactionList */
export const epcisWhySchema = z.object({
  businessStep: z.enum([
    "dispensing", "administering", "accepting", "reserving",
    "stat_administration", "returning",
  ]),
  disposition: z.enum([
    "in_progress", "in_transit", "in_stock",
    "consumed", "recalled", "expired", "non_sellable", "dispensed",
  ]),
  /** Referencia a la receta/indicación (bizTransactionList EPCIS) */
  bizTransactionId: z.string().optional(),
  bizTransactionType: z.enum(["po", "rma", "desadv"]).optional(),
});

/** WHO dimension: GSRN profesional + GSRN paciente */
export const epcisWhoSchema = z.object({
  gsrnProfesional: z.string().length(18).optional(),
  gsrnPaciente: z.string().length(18).optional(),
});

export const gs1EpcisDispensacionPayloadSchema = z.object({
  epcisEventId: z.string().uuid(),
  tipoEvento: z.literal("ObjectEvent"),
  subtipo: z.literal("PHARMACY_DISPENSE"),
  what: epcisWhatSchema,
  where: epcisWhereSchema,
  why: epcisWhySchema,
  who: epcisWhoSchema,
  payloadHash: z.string().length(64),
  establecimientoId: z.string().uuid(),
  indicationId: z.string().uuid().optional(),
});

export const gs1EpcisBedsidePayloadSchema = z.object({
  epcisEventId: z.string().uuid(),
  tipoEvento: z.literal("ObjectEvent"),
  subtipo: z.literal("BEDSIDE_ADMIN"),
  what: epcisWhatSchema,
  where: epcisWhereSchema,
  why: epcisWhySchema,
  who: epcisWhoSchema,
  payloadHash: z.string().length(64),
  establecimientoId: z.string().uuid(),
  indicationId: z.string().uuid().optional(),
});

export const gs1EpcisSubstitucionPayloadSchema = z.object({
  epcisEventId: z.string().uuid(),
  tipoEvento: z.literal("TransactionEvent"),
  subtipo: z.literal("SUBSTITUTION"),
  what: epcisWhatSchema,
  /** GTIN original que fue sustituido */
  gtinOriginal: z.string().length(14),
  where: epcisWhereSchema,
  why: epcisWhySchema,
  who: epcisWhoSchema,
  payloadHash: z.string().length(64),
  establecimientoId: z.string().uuid(),
});

export type Gs1EpcisDispensacionPayload = z.infer<typeof gs1EpcisDispensacionPayloadSchema>;
export type Gs1EpcisBedsidePayload = z.infer<typeof gs1EpcisBedsidePayloadSchema>;
export type Gs1EpcisSubstitucionPayload = z.infer<typeof gs1EpcisSubstitucionPayloadSchema>;

// -----------------------------------------------------------------------------
// farmacovigilancia.* — Incidentes de farmacovigilancia (Fase 2 S7, US.F2.6.56-57)
// -----------------------------------------------------------------------------

export const farmacovigilanciaIncidentBaseSchema = z.object({
  incidentId: z.string().uuid(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  patientId: z.string().uuid().optional(),
  gtin: z.string().length(14).optional(),
  gsrnEnfermera: z.string().length(18).optional(),
  establecimientoId: z.string().uuid(),
  detectedAt: z.string().datetime(),
});

export const farmacovigilanciaAlergiaPayloadSchema =
  farmacovigilanciaIncidentBaseSchema.extend({
    tipo: z.literal("ALERGIA_DETECTADA"),
    allergyId: z.string().uuid(),
    drugId: z.string().uuid().optional(),
    prescriberId: z.string().uuid().nullable(),
  });

export const farmacovigilanciaRecallPayloadSchema =
  farmacovigilanciaIncidentBaseSchema.extend({
    tipo: z.literal("RECALL_DETECTADO"),
    lote: z.string().min(1).max(50),
    glnUbicacion: z.string().length(13).optional(),
  });

export const farmacovigilanciaDobleDispPayloadSchema =
  farmacovigilanciaIncidentBaseSchema.extend({
    tipo: z.literal("DOBLE_DISPENSACION"),
    prescriptionItemId: z.string().uuid(),
    ventanaHoras: z.number().positive(),
  });

export const farmacovigilanciaVencidoPayloadSchema =
  farmacovigilanciaIncidentBaseSchema.extend({
    tipo: z.literal("DOSIS_VENCIDA"),
    lote: z.string().min(1).max(50),
    vencimiento: z.string(),
  });

export type FarmacovigilanciaAlergiaPayload = z.infer<typeof farmacovigilanciaAlergiaPayloadSchema>;
export type FarmacovigilanciaRecallPayload = z.infer<typeof farmacovigilanciaRecallPayloadSchema>;
export type FarmacovigilanciaDobleDispPayload = z.infer<typeof farmacovigilanciaDobleDispPayloadSchema>;
export type FarmacovigilanciaVencidoPayload = z.infer<typeof farmacovigilanciaVencidoPayloadSchema>;
// pharmacy.reservation.created / pharmacy.reservation.cancelled (US.F2.6.8)
// Emitidos cuando se crea o cancela una reserva lógica GS1.
// -----------------------------------------------------------------------------

export const pharmacyReservationCreatedPayloadSchema = z.object({
  reservationId: z.string().uuid(),
  patientId: z.string().uuid(),
  pharmacyOrderId: z.string().uuid(),
  gtin: z.string().length(14),
  lote: z.string().min(1).max(80),
  serie: z.string().max(80).optional(),
  expiresAt: z.string().datetime(),
  organizationId: z.string().uuid(),
});

export const pharmacyReservationCancelledPayloadSchema = z.object({
  reservationId: z.string().uuid(),
  motivo: z.string().min(1),
  cancelledBy: z.string().uuid(),
  patientId: z.string().uuid(),
  organizationId: z.string().uuid(),
});

export type PharmacyReservationCreatedPayload = z.infer<
  typeof pharmacyReservationCreatedPayloadSchema
>;
export type PharmacyReservationCancelledPayload = z.infer<
  typeof pharmacyReservationCancelledPayloadSchema
>;

// -----------------------------------------------------------------------------
// Discriminated union — un evento sólo es válido si su eventType matchea
// el shape exacto del payload correspondiente.
// -----------------------------------------------------------------------------

export const domainEventPayloadSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventType: z.literal("vital.critical"),
    payload: vitalCriticalPayloadSchema,
  }),
  z.object({
    eventType: z.literal("lab.criticalValue"),
    payload: labCriticalValuePayloadSchema,
  }),
  z.object({
    eventType: z.literal("drug.interaction"),
    payload: drugInteractionPayloadSchema,
  }),
  z.object({
    eventType: z.literal("allergy.mismatch"),
    payload: allergyMismatchPayloadSchema,
  }),
  z.object({
    eventType: z.literal("transfusion.crossmatchFailed"),
    payload: transfusionCrossmatchFailedPayloadSchema,
  }),
  z.object({
    eventType: z.literal("transfusion.adverseReaction"),
    payload: transfusionAdverseReactionPayloadSchema,
  }),
  z.object({
    eventType: z.literal("pathology.reportSigned"),
    payload: pathologyReportSignedPayloadSchema,
  }),
  z.object({
    eventType: z.literal("pathology.criticalFinding"),
    payload: pathologyCriticalFindingPayloadSchema,
  }),
  // Beta.18 — Contabilidad
  z.object({
    eventType: z.literal("accounting.periodClosed"),
    payload: accountingPeriodClosedPayloadSchema,
  }),
  z.object({
    eventType: z.literal("accounting.journalPostedHighValue"),
    payload: accountingJournalPostedHighValuePayloadSchema,
  }),
  // UAT-BUG-02 — Override clínico de alergia en orden nutricional
  z.object({
    eventType: z.literal("nutrition.allergyOverride"),
    payload: nutritionAllergyOverridePayloadSchema,
  }),
  // Fase 2 — Motor de Workflow ECE (Stream 15)
  z.object({
    eventType: z.literal("workflow.transitionExecuted"),
    payload: workflowTransitionExecutedPayloadSchema,
  }),
  // Fase 2 — ECE Triaje NTEC (Stream 02)
  z.object({
    eventType: z.literal("ece.triaje.firmado"),
    payload: eceTriajeFirmadoPayloadSchema,
  }),
  // Fase 2 — Indicaciones Médicas ECE (IND_MED)
  z.object({
    eventType: z.literal("ece.indicaciones.firmadas"),
    payload: eceIndicacionesFirmadasPayloadSchema,
  }),
  // Fase 2 — ECE Registro Enfermería (Stream 30)
  z.object({
    eventType: z.literal("ece.administracion.registrada"),
    payload: eceAdministracionRegistradaPayloadSchema,
  }),
  // Fase 2 — ECE Evolución Médica (Stream 11)
  z.object({
    eventType: z.literal("ece.evolucion.firmada"),
    payload: eceEvolucionFirmadaPayloadSchema,
  }),
  // Fase 2 — ECE Epicrisis de Egreso (NTEC §3.15, Art. 21)
  z.object({
    eventType: z.literal("ece.epicrisis.certificada"),
    payload: eceEpicrisisCertificadaPayloadSchema,
  }),
  // Fase 2 — Certificación DIR (Art. 21 NTEC)
  z.object({
    eventType: z.literal("ece.documento.certificado"),
    payload: eceDocumentoCertificadoPayloadSchema,
  }),
  // Fase 2 — Bridge ECE↔HIS
  z.object({
    eventType: z.literal("ece.paciente.linked"),
    payload: ecePacienteLinkedPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.paciente.synced"),
    payload: ecePacienteSyncedPayloadSchema,
  }),
  // Fase 2 — Bridge ECE↔HIS Encounter (Stream 22b)
  z.object({
    eventType: z.literal("ece.episodio.linkedToEncounter"),
    payload: eceEpisodioLinkedToEncounterPayloadSchema,
  }),
  // Fase 2 — Bridge ECE-HIS (Stream 18-ext)
  z.object({
    eventType: z.literal("ece.triaje.linkedToHisTriage"),
    payload: eceTriajeLinkedToHisTriagePayloadSchema,
  }),
  // Fase 2 — ECE Episodio de Atención (apertura / cierre)
  z.object({
    eventType: z.literal("ece.episodio.abierto"),
    payload: eceEpisodioAbiertoPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.episodio.cerrado"),
    payload: eceEpisodioCerradoPayloadSchema,
  }),
  // Fase 2 — ECE Atención de Emergencia (ATN_EMERG)
  z.object({
    eventType: z.literal("ece.atencion_emergencia.firmada"),
    payload: eceAtencionEmergenciaFirmadaPayloadSchema,
  }),
  // Fase 2 — ECE RRI (NTEC Doc 10)
  z.object({
    eventType: z.literal("ece.rri.firmada"),
    payload: eceRriFirmadaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.rri.respondida"),
    payload: eceRriRespondidaPayloadSchema,
  }),
  // Fase 2 — ECE Solicitud/Resultado Estudio (NTEC Doc 18)
  z.object({
    eventType: z.literal("ece.solicitud_estudio.firmada"),
    payload: eceSolicitudEstudioFirmadaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.solicitud_estudio.validada"),
    payload: eceSolicitudEstudioValidadaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.solicitud_estudio.anulada"),
    payload: eceSolicitudEstudioAnuladaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.resultado_estudio.registrado"),
    payload: eceResultadoEstudioRegistradoPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.resultado_estudio.aprobado"),
    payload: eceResultadoEstudioAprobadoPayloadSchema,
  }),
  // Fase 2 — ECE Hoja de Ingreso Hospitalario (Doc 12 NTEC)
  z.object({
    eventType: z.literal("ece.hoja_ingreso.firmada"),
    payload: eceHojaIngresoFirmadaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.hoja_ingreso.validada"),
    payload: eceHojaIngresoValidadaPayloadSchema,
  }),
  // Fase 2 — Bridge Admisión Hospitalaria
  z.object({
    eventType: z.literal("ece.admision.completada"),
    payload: eceAdmisionCompletadaPayloadSchema,
  }),
  // Fase 2 (S4) — ECE Valoración Inicial Enfermería
  z.object({
    eventType: z.literal("ece.valoracion_inicial.firmada"),
    payload: eceValoracionInicialFirmadaPayloadSchema,
  }),
  // Fase 2 (S4) — ECE Episodio Hospitalario alta médica
  z.object({
    eventType: z.literal("ece.episodio.altaIniciada"),
    payload: eceEpisodioAltaIniciadaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.episodio.altaConfirmada"),
    payload: eceEpisodioAltaConfirmadaPayloadSchema,
  }),
  // Fase 2 (S4) — ECE Certificado de Defunción
  z.object({
    eventType: z.literal("ece.certificado_defuncion.firmado"),
    payload: eceCertificadoDefuncionFirmadoPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.certificado_defuncion.certificado"),
    payload: eceCertificadoDefuncionCertificadoPayloadSchema,
  }),
  // Fase 2 (S7) — GS1 Proceso A: Inbound
  z.object({
    eventType: z.literal("gs1.inbound.recibido"),
    payload: gs1InboundRecibidoPayloadSchema,
  }),
  z.object({
    eventType: z.literal("gs1.inbound.rechazado"),
    payload: gs1InboundRechazadoPayloadSchema,
  }),
  // Proceso C GS1 — Preparación Unidosis
  z.object({
    eventType: z.literal("gs1.unidosis.preparada"),
    payload: gs1UnidosisPreparadaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("gs1.unidosis.verificada"),
    payload: gs1UnidosisVerificadaPayloadSchema,
  }),
  // F2-S15 placeholder — Cold Chain
  z.object({
    eventType: z.literal("cold_chain.excursion"),
    payload: coldChainExcursionPayloadSchema,
  }),
  // Fase 2 S5 — ECE Preoperatorio
  z.object({
    eventType: z.literal("ece.preop_checklist.firmado"),
    payload: ecePreopChecklistFirmadoPayloadSchema,
  }),
  // Fase 2 S5 — Bridge Cirugía
  z.object({
    eventType: z.literal("ece.cirugia.programada"),
    payload: eceCirugiaProgramadaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.cirugia.cancelada"),
    payload: eceCirugiaCanceladaPayloadSchema,
  }),
  // Fase 2 S5 — ECE Atención RN
  z.object({
    eventType: z.literal("ece.rn.registrado"),
    payload: eceRnRegistradoPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.rn.reanimacion_requerida"),
    payload: eceRnReanimacionRequeridaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("ece.rn.firmado"),
    payload: eceRnFirmadoPayloadSchema,
  }),
  // Fase 2 S5 — ECE Partograma
  z.object({
    eventType: z.literal("ece.partograma.alerta"),
    payload: ecePartogramaAlertaPayloadSchema,
  }),
  // Fase 2 S5 — Período Expulsivo
  z.object({
    eventType: z.literal("ece.expulsion.hemorragia_post_parto_alerta"),
    payload: eceExpulsionHemorragiaPostPartoAlertaPayloadSchema,
  }),
  // Fase 2 S7 — GS1 Proceso B
  z.object({
    eventType: z.literal("gs1.transfer.enviada"),
    payload: gs1TransferEnviadaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("gs1.transfer.recibida"),
    payload: gs1TransferRecibidaRechazadaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("gs1.transfer.rechazada"),
    payload: gs1TransferRecibidaRechazadaPayloadSchema,
  }),
  // Fase 2 S5 — ECE Registro Anestésico
  z.object({
    eventType: z.literal("ece.anestesia.firmada"),
    payload: eceAnestesiaFirmadaPayloadSchema,
  // Fase 2 (S7) — Sustitución genérico-comercial (US.F2.6.11)
  z.object({
    eventType: z.literal("pharmacy.substitution.proposed"),
    payload: pharmacySubstitutionProposedPayloadSchema,
  }),
  z.object({
    eventType: z.literal("pharmacy.substitution.authorized"),
    payload: pharmacySubstitutionDecidedPayloadSchema,
  }),
  z.object({
    eventType: z.literal("pharmacy.substitution.rejected"),
    payload: pharmacySubstitutionDecidedPayloadSchema,
  // Fase 2 (S7) — GS1 EPCIS bedside events
  z.object({
    eventType: z.literal("gs1.epcis.dispensacion"),
    payload: gs1EpcisDispensacionPayloadSchema,
  }),
  z.object({
    eventType: z.literal("gs1.epcis.bedside"),
    payload: gs1EpcisBedsidePayloadSchema,
  }),
  z.object({
    eventType: z.literal("gs1.epcis.sustitucion"),
    payload: gs1EpcisSubstitucionPayloadSchema,
  }),
  // Fase 2 (S7) — Farmacovigilancia
  z.object({
    eventType: z.literal("farmacovigilancia.alergia_detectada"),
    payload: farmacovigilanciaAlergiaPayloadSchema,
  }),
  z.object({
    eventType: z.literal("farmacovigilancia.recall_detectado"),
    payload: farmacovigilanciaRecallPayloadSchema,
  }),
  z.object({
    eventType: z.literal("farmacovigilancia.doble_dispensacion"),
    payload: farmacovigilanciaDobleDispPayloadSchema,
  }),
  z.object({
    eventType: z.literal("farmacovigilancia.dosis_vencida"),
    payload: farmacovigilanciaVencidoPayloadSchema,
  // Fase 2 (S7) — GS1 Proceso D: Reserva lógica de serial/lote (US.F2.6.8)
  z.object({
    eventType: z.literal("pharmacy.reservation.created"),
    payload: pharmacyReservationCreatedPayloadSchema,
  }),
  z.object({
    eventType: z.literal("pharmacy.reservation.cancelled"),
    payload: pharmacyReservationCancelledPayloadSchema,
  }),
]);

export type DomainEventPayloadInput = z.infer<typeof domainEventPayloadSchema>;
export type VitalCriticalPayload = z.infer<typeof vitalCriticalPayloadSchema>;
export type LabCriticalValuePayload = z.infer<typeof labCriticalValuePayloadSchema>;
export type DrugInteractionPayload = z.infer<typeof drugInteractionPayloadSchema>;
export type AllergyMismatchPayload = z.infer<typeof allergyMismatchPayloadSchema>;
export type TransfusionCrossmatchFailedPayload = z.infer<typeof transfusionCrossmatchFailedPayloadSchema>;
export type TransfusionAdverseReactionPayload = z.infer<typeof transfusionAdverseReactionPayloadSchema>;
export type PathologyReportSignedPayload = z.infer<typeof pathologyReportSignedPayloadSchema>;
export type PathologyCriticalFindingPayload = z.infer<typeof pathologyCriticalFindingPayloadSchema>;
export type AccountingPeriodClosedPayload = z.infer<typeof accountingPeriodClosedPayloadSchema>;
export type AccountingJournalPostedHighValuePayload = z.infer<typeof accountingJournalPostedHighValuePayloadSchema>;
