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

// -----------------------------------------------------------------------------
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
  // Beta.18 — Contabilidad
  z.object({
    eventType: z.literal("accounting.periodClosed"),
    payload: accountingPeriodClosedPayloadSchema,
  }),
  z.object({
    eventType: z.literal("accounting.journalPostedHighValue"),
    payload: accountingJournalPostedHighValuePayloadSchema,
  }),
]);

export type DomainEventPayloadInput = z.infer<typeof domainEventPayloadSchema>;
export type VitalCriticalPayload = z.infer<typeof vitalCriticalPayloadSchema>;
export type LabCriticalValuePayload = z.infer<typeof labCriticalValuePayloadSchema>;
export type DrugInteractionPayload = z.infer<typeof drugInteractionPayloadSchema>;
export type AllergyMismatchPayload = z.infer<typeof allergyMismatchPayloadSchema>;
export type TransfusionCrossmatchFailedPayload = z.infer<typeof transfusionCrossmatchFailedPayloadSchema>;
export type TransfusionAdverseReactionPayload = z.infer<typeof transfusionAdverseReactionPayloadSchema>;
export type AccountingPeriodClosedPayload = z.infer<typeof accountingPeriodClosedPayloadSchema>;
export type AccountingJournalPostedHighValuePayload = z.infer<typeof accountingJournalPostedHighValuePayloadSchema>;
