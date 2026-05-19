import { z } from "zod";

export const triageColorEnum = z.enum(["RED", "ORANGE", "YELLOW", "GREEN", "BLUE"]);

/**
 * US-6.2 — códigos de signos vitales aceptados en triage.
 * Alineado con TDR §9.2 (lista mínima Manchester) + Glasgow + dolor + glucosa.
 */
export const triageVitalCodeEnum = z.enum([
  "BP_SYS", // Presión sistólica   (mmHg)
  "BP_DIA", // Presión diastólica  (mmHg)
  "HR", //     Frecuencia cardíaca (lpm)
  "RR", //     Frecuencia resp.    (rpm)
  "TEMP", //   Temperatura         (°C)
  "SPO2", //   Saturación O2       (%)
  "GCS", //    Glasgow Coma Scale  (3-15)
  "PAIN", //   Escala dolor EVA    (0-10)
  "GLUCOSE", // Glucemia capilar   (mg/dL)
]);
export type TriageVitalCode = z.infer<typeof triageVitalCodeEnum>;

/** Rango razonable por código (anti-typo). Más permisivo que un alerting clínico. */
export const VITAL_REASONABLE_RANGES: Record<
  TriageVitalCode,
  { min: number; max: number; unit: string }
> = {
  BP_SYS: { min: 30, max: 300, unit: "mmHg" },
  BP_DIA: { min: 20, max: 220, unit: "mmHg" },
  HR: { min: 20, max: 260, unit: "lpm" },
  RR: { min: 4, max: 80, unit: "rpm" },
  TEMP: { min: 25, max: 45, unit: "°C" },
  SPO2: { min: 40, max: 100, unit: "%" },
  GCS: { min: 3, max: 15, unit: "" },
  PAIN: { min: 0, max: 10, unit: "" },
  GLUCOSE: { min: 10, max: 1200, unit: "mg/dL" },
};

export const vitalSignSchema = z.object({
  /** SpO2, BP_SYS, BP_DIA, HR, RR, TEMP, GCS, PAIN, GLUC */
  vitalCode: z.string().min(1).max(40),
  valueNumeric: z.number().nullable().optional(),
  valueText: z.string().max(120).nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
});

/**
 * US-6.2 — input estricto para `triage.recordVitals`.
 * Acepta sólo códigos del enum, valida rangos razonables y permite override
 * de `takenAt` (cuando un paramédico carga signos retro-fechados).
 */
export const triageVitalInputSchema = z
  .object({
    vitalCode: triageVitalCodeEnum,
    valueNumeric: z.number().finite().nullable().optional(),
    valueText: z.string().max(120).nullable().optional(),
    unit: z.string().max(20).nullable().optional(),
    takenAt: z.coerce.date().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.valueNumeric == null && (!d.valueText || d.valueText.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valueNumeric"],
        message: "Debe ingresar valor numérico o texto.",
      });
      return;
    }
    if (d.valueNumeric != null) {
      const r = VITAL_REASONABLE_RANGES[d.vitalCode];
      if (d.valueNumeric < r.min || d.valueNumeric > r.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["valueNumeric"],
          message: `Valor fuera de rango razonable (${r.min}-${r.max} ${r.unit}).`,
        });
      }
    }
  });

export const recordVitalsInputSchema = z.object({
  triageEvaluationId: z.string().uuid(),
  vitals: z.array(triageVitalInputSchema).min(1).max(20),
});

/** Severidad de la alerta calculada (cliente y/o servidor). */
export const vitalAlertSeverityEnum = z.enum(["CRITICAL", "WARNING", "INFO"]);
export const vitalAlertSchema = z.object({
  vitalCode: triageVitalCodeEnum,
  severity: vitalAlertSeverityEnum,
  message: z.string(),
});

export type TriageVitalInput = z.infer<typeof triageVitalInputSchema>;
export type RecordVitalsInput = z.infer<typeof recordVitalsInputSchema>;
export type VitalAlertSeverity = z.infer<typeof vitalAlertSeverityEnum>;
export type VitalAlert = z.infer<typeof vitalAlertSchema>;

// =============================================================================
// US-6.1 — Recepción rápida en triage.
// =============================================================================

/**
 * Sub-schema cuando el modo es "NN" (paciente desconocido).
 * `description` se trunca a 100 chars y se guarda en `lastName`.
 */
export const quickIntakeNNFieldsSchema = z.object({
  estimatedAge: z.number().int().min(0).max(130).optional(),
  /** UUID del catálogo `biologicalSex`. */
  sexAtBirthId: z.string().uuid(),
  description: z
    .string()
    .trim()
    .min(2, "Describe rasgos visibles para distinguir al paciente.")
    .max(100, "Máximo 100 caracteres."),
});

/**
 * Input de `triage.quickIntake`. Discriminated union por `mode`:
 *  - EXISTING_PATIENT: se requiere `patientId`.
 *  - NN: se requiere `nnFields` con sexo + descripción.
 */
export const quickIntakeInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("EXISTING_PATIENT"),
    patientId: z.string().uuid(),
  }),
  z.object({
    mode: z.literal("NN"),
    nnFields: quickIntakeNNFieldsSchema,
  }),
]);

export type QuickIntakeInput = z.infer<typeof quickIntakeInputSchema>;
export type QuickIntakeNNFields = z.infer<typeof quickIntakeNNFieldsSchema>;

export const discriminatorHitSchema = z.object({
  discriminatorId: z.string().uuid(),
  positive: z.boolean(),
  notes: z.string().max(400).optional(),
});

export const triageEvaluationCreateSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().optional(),
  flowchartId: z.string().uuid(),
  serviceUnitId: z.string().uuid().optional(),
  assignedLevelId: z.string().uuid(),
  systemSuggestedLevelId: z.string().uuid().optional(),
  overrideJustification: z.string().max(2000).optional(),
  vitalSigns: z.array(vitalSignSchema).default([]),
  discriminatorHits: z.array(discriminatorHitSchema).default([]),
});

export type TriageEvaluationCreateInput = z.infer<typeof triageEvaluationCreateSchema>;
export type VitalSignInput = z.infer<typeof vitalSignSchema>;
export type DiscriminatorHitInput = z.infer<typeof discriminatorHitSchema>;

/**
 * US-3.4 — Cierre de triage Manchester desde wizard de discriminadores.
 *
 * Confirma el nivel asignado para una `TriageEvaluation` IN_PROGRESS:
 *   - Persiste los hits de discriminadores (audit del razonamiento del triagista).
 *   - Actualiza assignedLevelId + status COMPLETED + completedAt.
 *   - overrideJustification es obligatorio cuando el triagista elige un nivel
 *     distinto al sugerido por el primer discriminador positivo (control de calidad).
 *
 * El triagista NO puede regresar al estado IN_PROGRESS (transición irreversible).
 */
export const setAssignedLevelInputSchema = z.object({
  triageEvaluationId: z.string().uuid(),
  assignedLevelId: z.string().uuid(),
  overrideJustification: z.string().trim().min(10).max(2000).optional(),
  discriminatorHits: z.array(discriminatorHitSchema).default([]),
});

export type SetAssignedLevelInput = z.infer<typeof setAssignedLevelInputSchema>;
