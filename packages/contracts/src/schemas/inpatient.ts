/**
 * §11 Inpatient (Hospitalización) — schemas de input.
 * Skeleton mínimo. Reglas de transición de estado y validaciones de LOS
 * exhaustivas viven en el router; aquí sólo se valida la forma del contrato.
 */
import { z } from "zod";

const INPATIENT_STATUS = [
  "ACTIVE",
  "ON_LEAVE",
  "DISCHARGED",
  "TRANSFERRED_OUT",
] as const;

const CARE_PLAN_STATUS = [
  "DRAFT",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
] as const;

const KARDEX_CATEGORY = [
  "DIET",
  "ACTIVITY",
  "OBSERVATION",
  "PROCEDURE",
  "NURSING",
  "OTHER",
] as const;

const KARDEX_SHIFT = ["MORNING", "AFTERNOON", "NIGHT"] as const;

export const inpatientStatusEnum = z.enum(INPATIENT_STATUS);
export const carePlanStatusEnum = z.enum(CARE_PLAN_STATUS);
export const kardexCategoryEnum = z.enum(KARDEX_CATEGORY);
export const kardexShiftEnum = z.enum(KARDEX_SHIFT);

export type InpatientStatusType = z.infer<typeof inpatientStatusEnum>;
export type CarePlanStatusType = z.infer<typeof carePlanStatusEnum>;

export const inpatientAdmissionCreateInput = z.object({
  encounterId: z.string().uuid(),
  establishmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  attendingId: z.string().uuid(),
  reason: z.string().trim().min(1).max(400),
  expectedLos: z.number().int().min(1).max(365).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const inpatientAdmissionListInput = z.object({
  status: inpatientStatusEnum.optional(),
  patientId: z.string().uuid().optional(),
  attendingId: z.string().uuid().optional(),
  establishmentId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const inpatientAdmissionDischargeInput = z.object({
  id: z.string().uuid(),
  notes: z.string().trim().max(4000).optional(),
});

export const inpatientVitalsRecordInput = z.object({
  admissionId: z.string().uuid(),
  temperatureC: z.number().min(25).max(45).optional(),
  heartRate: z.number().int().min(20).max(250).optional(),
  respiratoryRate: z.number().int().min(4).max(80).optional(),
  systolicBp: z.number().int().min(40).max(260).optional(),
  diastolicBp: z.number().int().min(20).max(180).optional(),
  spo2: z.number().int().min(40).max(100).optional(),
  painScale: z.number().int().min(0).max(10).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const inpatientKardexCreateInput = z.object({
  admissionId: z.string().uuid(),
  category: kardexCategoryEnum,
  entry: z.string().trim().min(1).max(4000),
  shift: kardexShiftEnum.optional(),
});

export const inpatientCarePlanCreateInput = z.object({
  admissionId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  goal: z.string().trim().max(2000).optional(),
  interventions: z.string().trim().max(4000).optional(),
});

export const inpatientCarePlanUpdateStatusInput = z.object({
  id: z.string().uuid(),
  status: carePlanStatusEnum,
});

export type InpatientAdmissionCreateInput = z.infer<typeof inpatientAdmissionCreateInput>;
export type InpatientAdmissionListInput = z.infer<typeof inpatientAdmissionListInput>;
export type InpatientAdmissionDischargeInput = z.infer<typeof inpatientAdmissionDischargeInput>;
export type InpatientVitalsRecordInput = z.infer<typeof inpatientVitalsRecordInput>;
export type InpatientKardexCreateInput = z.infer<typeof inpatientKardexCreateInput>;
export type InpatientCarePlanCreateInput = z.infer<typeof inpatientCarePlanCreateInput>;
export type InpatientCarePlanUpdateStatusInput = z.infer<typeof inpatientCarePlanUpdateStatusInput>;
