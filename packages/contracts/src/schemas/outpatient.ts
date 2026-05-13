/**
 * §10 Outpatient (Consulta Externa) — schemas de input.
 *
 * Beta.7 hardening layer 1:
 *  - reasonCategory enum (ROUTINE/FOLLOWUP/ACUTE/PREVENTIVE/CHRONIC/OTHER)
 *  - reason/reasonOfVisit max bumped to 500 chars
 *  - ALLOWED_TRANSITIONS para state machine validada en router
 *  - noShowDetectInput para endpoint detectNoShows
 */
import { z } from "zod";

const APPOINTMENT_STATUS = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "NO_SHOW",
  "COMPLETED",
  "CANCELLED",
] as const;

export const appointmentStatusEnum = z.enum(APPOINTMENT_STATUS);
export type AppointmentStatusType = z.infer<typeof appointmentStatusEnum>;

export const REASON_CATEGORY = [
  "ROUTINE",
  "FOLLOWUP",
  "ACUTE",
  "PREVENTIVE",
  "CHRONIC",
  "OTHER",
] as const;

export const reasonCategoryEnum = z.enum(REASON_CATEGORY);
export type ReasonCategoryType = z.infer<typeof reasonCategoryEnum>;

/**
 * Valid state machine transitions.
 *
 * SCHEDULED   -> CONFIRMED | CHECKED_IN | CANCELLED | NO_SHOW
 * CONFIRMED   -> CHECKED_IN | CANCELLED | NO_SHOW
 * CHECKED_IN  -> COMPLETED | CANCELLED
 * NO_SHOW / COMPLETED / CANCELLED -> (terminal)
 */
export const ALLOWED_TRANSITIONS: Record<
  AppointmentStatusType,
  ReadonlyArray<AppointmentStatusType>
> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["COMPLETED", "CANCELLED"],
  NO_SHOW: [],
  COMPLETED: [],
  CANCELLED: [],
};

export const outpatientAppointmentCreateInput = z.object({
  patientId: z.string().uuid(),
  providerId: z.string().uuid(),
  establishmentId: z.string().uuid(),
  specialtyId: z.string().uuid().optional(),
  serviceUnitId: z.string().uuid().optional(),
  scheduledAt: z.coerce.date().refine((d) => d > new Date(), {
    message: "scheduledAt debe ser futuro",
  }),
  durationMinutes: z.number().int().min(5).max(180).default(20),
  reason: z.string().trim().max(500).optional(),
  reasonCategory: reasonCategoryEnum.optional(),
});

export const outpatientAppointmentUpdateInput = z.object({
  id: z.string().uuid(),
  status: appointmentStatusEnum.optional(),
  scheduledAt: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(5).max(180).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  reasonCategory: reasonCategoryEnum.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export const outpatientAppointmentListInput = z.object({
  providerId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: appointmentStatusEnum.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const outpatientAppointmentCancelInput = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

export const noShowDetectInput = z.object({
  thresholdMinutes: z.number().int().min(1).max(1440).default(30),
  commit: z.boolean().default(false),
});

export const outpatientConsultationCreateInput = z.object({
  appointmentId: z.string().uuid().optional(),
  encounterId: z.string().uuid(),
  reasonOfVisit: z.string().trim().min(1).max(500),
  reasonCategory: reasonCategoryEnum.optional(),
  subjective: z.string().trim().max(8000).optional(),
  objective: z.string().trim().max(8000).optional(),
  assessment: z.string().trim().max(8000).optional(),
  plan: z.string().trim().max(8000).optional(),
});

export type OutpatientAppointmentCreateInput = z.infer<typeof outpatientAppointmentCreateInput>;
export type OutpatientAppointmentUpdateInput = z.infer<typeof outpatientAppointmentUpdateInput>;
export type OutpatientAppointmentListInput = z.infer<typeof outpatientAppointmentListInput>;
export type OutpatientAppointmentCancelInput = z.infer<typeof outpatientAppointmentCancelInput>;
export type NoShowDetectInput = z.infer<typeof noShowDetectInput>;
export type OutpatientConsultationCreateInput = z.infer<typeof outpatientConsultationCreateInput>;