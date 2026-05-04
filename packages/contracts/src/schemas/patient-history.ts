import { z } from "zod";

/**
 * US-4.8 — Antecedentes clínicos (familiares, personales, gineco-obstétricos,
 * pediátricos).
 *
 * Decisión de almacenamiento (MVP):
 *  - NO se crea tabla `PatientMedicalHistory` en este sprint para evitar tocar
 *    `schema.prisma` (paralelismo con 9 equipos).
 *  - Se persiste el snapshot completo dentro de `audit.AuditLog` con
 *    `entity = "PatientHistory"`, `entityId = patientId`, `action = UPDATE`,
 *    `afterJson = { op: "PATIENT_HISTORY_UPDATED", history: <PatientHistoryShape> }`.
 *  - El `get(patientId)` reconstruye el estado actual desde el último audit log
 *    con ese `entity/entityId`. Esto da auditoría histórica gratis (cada save es
 *    un nuevo snapshot) y append-only inmutable.
 *  - TODO(Sprint 4): migrar a tabla `PatientMedicalHistory` con columna `data Jsonb`
 *    + última-versión denormalizada por paciente, conservando audit log como log de
 *    cambios (lo de hoy se vuelve fuente histórica).
 *  - Las alergias siguen viviendo en `PatientAllergy` (estructura tipada existente);
 *    el bloque `personal.allergies` solo guarda referencias (IDs) para correlación
 *    sin duplicar datos.
 */

// =============================================================================
// 1) Antecedentes familiares
// =============================================================================
export const familialHistorySchema = z.object({
  diabetes: z.boolean().default(false),
  hypertension: z.boolean().default(false),
  cancer: z.object({
    present: z.boolean().default(false),
    detail: z.string().max(400).nullable().optional(), // tipo + parentesco.
  }),
  heartDisease: z.boolean().default(false),
  mentalIllness: z.boolean().default(false),
  other: z.string().max(800).nullable().optional(),
});

// =============================================================================
// 2) Antecedentes personales (no-patológicos + patológicos light)
// =============================================================================
export const surgeryEntrySchema = z.object({
  date: z.coerce.date().nullable().optional(),
  procedure: z.string().min(1).max(200),
  notes: z.string().max(400).nullable().optional(),
});

export const medicationEntrySchema = z.object({
  name: z.string().min(1).max(160),
  dose: z.string().max(80).nullable().optional(),
  chronic: z.boolean().default(false),
  startDate: z.coerce.date().nullable().optional(),
});

export const personalHistorySchema = z.object({
  chronicConditions: z.array(z.string().min(1).max(160)).max(50).default([]),
  surgeries: z.array(surgeryEntrySchema).max(50).default([]),
  /** IDs de PatientAllergy ya existentes (referencia, no duplicación). */
  allergyRefs: z.array(z.string().uuid()).max(50).default([]),
  medications: z.array(medicationEntrySchema).max(50).default([]),
  habits: z
    .object({
      tobacco: z.boolean().default(false),
      alcohol: z.boolean().default(false),
      drugs: z.boolean().default(false),
      detail: z.string().max(400).nullable().optional(),
    })
    .default({ tobacco: false, alcohol: false, drugs: false }),
});

// =============================================================================
// 3) Gineco-obstétricos (solo aplica si paciente con biologicalSex = F)
// =============================================================================
export const gpacSchema = z.object({
  /** G — gestaciones totales. */
  G: z.number().int().min(0).max(30).default(0),
  /** P — partos. */
  P: z.number().int().min(0).max(30).default(0),
  /** A — abortos. */
  A: z.number().int().min(0).max(30).default(0),
  /** C — cesáreas. */
  C: z.number().int().min(0).max(30).default(0),
});

export const gynecoHistorySchema = z.object({
  menarcheAge: z.number().int().min(7).max(20).nullable().optional(),
  cycle: z.enum(["regular", "irregular", "amenorrhea", "menopause"]).nullable().optional(),
  /** FUM — fecha de última menstruación. */
  lastPeriod: z.coerce.date().nullable().optional(),
  gpac: gpacSchema.default({ G: 0, P: 0, A: 0, C: 0 }),
  contraceptiveMethod: z
    .enum(["none", "oral", "iud", "injection", "barrier", "implant", "tubal", "other"])
    .nullable()
    .optional(),
  notes: z.string().max(800).nullable().optional(),
});

// =============================================================================
// 4) Pediátricos (solo aplica si paciente neonato/lactante/infante)
// =============================================================================
export const pediatricHistorySchema = z.object({
  gestationalAgeWeeks: z.number().int().min(20).max(45).nullable().optional(),
  birthWeightGrams: z.number().int().min(200).max(8000).nullable().optional(),
  breastfeeding: z.object({
    given: z.boolean().default(false),
    months: z.number().int().min(0).max(36).nullable().optional(),
    exclusiveMonths: z.number().int().min(0).max(12).nullable().optional(),
  }),
  milestones: z.string().max(800).nullable().optional(),
  immunizationsUpToDate: z.boolean().default(false),
});

// =============================================================================
// Bundle: shape completo persistido en audit.afterJson.history
// =============================================================================
export const patientHistorySchema = z.object({
  familial: familialHistorySchema,
  personal: personalHistorySchema,
  gyneco: gynecoHistorySchema.nullable().optional(),
  pediatric: pediatricHistorySchema.nullable().optional(),
});

export const patientHistoryGetInput = z.object({
  patientId: z.string().uuid(),
});

export const patientHistoryUpdateInput = z.object({
  patientId: z.string().uuid(),
  history: patientHistorySchema,
});

export type FamilialHistory = z.infer<typeof familialHistorySchema>;
export type PersonalHistory = z.infer<typeof personalHistorySchema>;
export type GynecoHistory = z.infer<typeof gynecoHistorySchema>;
export type PediatricHistory = z.infer<typeof pediatricHistorySchema>;
export type PatientHistory = z.infer<typeof patientHistorySchema>;
export type PatientHistoryUpdateInput = z.infer<typeof patientHistoryUpdateInput>;
export type PatientHistoryGetInput = z.infer<typeof patientHistoryGetInput>;

/** Sentinel constante usado en audit.afterJson.op. */
export const PATIENT_HISTORY_OP = "PATIENT_HISTORY_UPDATED" as const;
export const PATIENT_HISTORY_ENTITY = "PatientHistory" as const;
