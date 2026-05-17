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
  // Fase 2 — Indicaciones Médicas ECE (IND_MED)
  z.object({
    eventType: z.literal("ece.indicaciones.firmadas"),
    payload: eceIndicacionesFirmadasPayloadSchema,
  // Fase 2 — ECE Registro Enfermería (Stream 30)
  z.object({
    eventType: z.literal("ece.administracion.registrada"),
    payload: eceAdministracionRegistradaPayloadSchema,
  // Fase 2 — ECE Evolución Médica (Stream 11)
  z.object({
    eventType: z.literal("ece.evolucion.firmada"),
    payload: eceEvolucionFirmadaPayloadSchema,
  // Fase 2 — ECE Epicrisis de Egreso (NTEC §3.15, Art. 21)
  z.object({
    eventType: z.literal("ece.epicrisis.certificada"),
    payload: eceEpicrisisCertificadaPayloadSchema,
  // Fase 2 — Certificación DIR (Art. 21 NTEC)
  z.object({
    eventType: z.literal("ece.documento.certificado"),
    payload: eceDocumentoCertificadoPayloadSchema,
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
