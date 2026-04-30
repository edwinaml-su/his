import { z } from "zod";

export const triageColorEnum = z.enum(["RED", "ORANGE", "YELLOW", "GREEN", "BLUE"]);

export const vitalSignSchema = z.object({
  /** SpO2, BP_SYS, BP_DIA, HR, RR, TEMP, GCS, PAIN, GLUC */
  vitalCode: z.string().min(1).max(40),
  valueNumeric: z.number().nullable().optional(),
  valueText: z.string().max(120).nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
});

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
