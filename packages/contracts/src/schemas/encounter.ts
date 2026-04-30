import { z } from "zod";

export const admissionTypeEnum = z.enum([
  "EMERGENCY",
  "SCHEDULED",
  "TRANSFER_IN",
  "BIRTH",
  "NEWBORN",
]);

export const dischargeTypeEnum = z.enum([
  "MEDICAL",
  "VOLUNTARY",
  "TRANSFER_OUT",
  "ABSCONDED",
  "DEATH",
  "AGAINST_MEDICAL_ADVICE",
]);

export const admitSchema = z.object({
  patientId: z.string().uuid(),
  serviceUnitId: z.string().uuid().optional(),
  patientTypeId: z.string().uuid().optional(),
  patientCategoryId: z.string().uuid().optional(),
  admissionType: admissionTypeEnum,
  admittedAt: z.coerce.date().optional(),
  currencyId: z.string().uuid(),
});

export const transferSchema = z.object({
  encounterId: z.string().uuid(),
  toServiceId: z.string().uuid(),
  fromServiceId: z.string().uuid().optional(),
  fromBedId: z.string().uuid().optional(),
  toBedId: z.string().uuid().optional(),
  reason: z.string().min(2).max(200),
});

export const dischargeSchema = z.object({
  encounterId: z.string().uuid(),
  dischargeType: dischargeTypeEnum,
  dischargedAt: z.coerce.date().optional(),
  primaryDiagnosisId: z.string().uuid().optional(),
});

export const encounterListSchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z.enum(["OPEN", "CLOSED", "ALL"]).default("OPEN"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type AdmitInput = z.infer<typeof admitSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type DischargeInput = z.infer<typeof dischargeSchema>;
export type EncounterListInput = z.infer<typeof encounterListSchema>;
