/**
 * §12 Emergency (Urgencias) — schemas de input.
 * Skeleton mínimo. Reglas de transición de disposition y LWBS automation
 * viven en el router; aquí sólo forma del contrato.
 */
import { z } from "zod";

const DISPOSITION = [
  "PENDING",
  "DISCHARGED",
  "ADMITTED",
  "TRANSFERRED",
  "LWBS",
  "AMA",
  "DECEASED",
] as const;

const ARRIVAL_MODE = [
  "WALK_IN",
  "AMBULANCE",
  "POLICE",
  "REFERRAL",
  "PRIVATE_VEHICLE",
  "OTHER",
] as const;

const EMERGENCY_NOTE_CATEGORY = [
  "OBSERVATION",
  "TREATMENT",
  "REASSESSMENT",
] as const;

export const emergencyDispositionEnum = z.enum(DISPOSITION);
export const emergencyArrivalModeEnum = z.enum(ARRIVAL_MODE);
export const emergencyNoteCategoryEnum = z.enum(EMERGENCY_NOTE_CATEGORY);

export type EmergencyDispositionType = z.infer<typeof emergencyDispositionEnum>;

export const emergencyVisitCreateInput = z.object({
  encounterId: z.string().uuid(),
  establishmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  chiefComplaint: z.string().trim().min(1).max(400),
  arrivalMode: emergencyArrivalModeEnum.default("WALK_IN"),
  treatingId: z.string().uuid().optional(),
});

export const emergencyVisitListInput = z.object({
  disposition: emergencyDispositionEnum.optional(),
  patientId: z.string().uuid().optional(),
  treatingId: z.string().uuid().optional(),
  establishmentId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const emergencyVisitDispositionInput = z.object({
  id: z.string().uuid(),
  disposition: emergencyDispositionEnum,
  notes: z.string().trim().max(4000).optional(),
});

export const emergencyVisitStartObservationInput = z.object({
  id: z.string().uuid(),
});

export const emergencyVisitEndObservationInput = z.object({
  id: z.string().uuid(),
});

export const emergencyNoteCreateInput = z.object({
  visitId: z.string().uuid(),
  category: emergencyNoteCategoryEnum,
  body: z.string().trim().min(1).max(8000),
});

export type EmergencyVisitCreateInput = z.infer<typeof emergencyVisitCreateInput>;
export type EmergencyVisitListInput = z.infer<typeof emergencyVisitListInput>;
export type EmergencyVisitDispositionInput = z.infer<typeof emergencyVisitDispositionInput>;
export type EmergencyNoteCreateInput = z.infer<typeof emergencyNoteCreateInput>;
