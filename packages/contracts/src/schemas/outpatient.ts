/**
 * §10 Outpatient (Consulta Externa) — schemas de input.
 * Skeleton mínimo. UI + RLS + tests en commits futuros.
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
  reason: z.string().trim().max(400).optional(),
});

export const outpatientAppointmentUpdateInput = z.object({
  id: z.string().uuid(),
  status: appointmentStatusEnum.optional(),
  scheduledAt: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(5).max(180).optional(),
  reason: z.string().trim().max(400).nullable().optional(),
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
  reason: z.string().trim().min(1).max(400),
});

export const outpatientConsultationCreateInput = z.object({
  appointmentId: z.string().uuid().optional(),
  encounterId: z.string().uuid(),
  reasonOfVisit: z.string().trim().min(1).max(400),
  subjective: z.string().trim().max(8000).optional(),
  objective: z.string().trim().max(8000).optional(),
  assessment: z.string().trim().max(8000).optional(),
  plan: z.string().trim().max(8000).optional(),
});

export type OutpatientAppointmentCreateInput = z.infer<typeof outpatientAppointmentCreateInput>;
export type OutpatientAppointmentUpdateInput = z.infer<typeof outpatientAppointmentUpdateInput>;
export type OutpatientAppointmentListInput = z.infer<typeof outpatientAppointmentListInput>;
export type OutpatientAppointmentCancelInput = z.infer<typeof outpatientAppointmentCancelInput>;
export type OutpatientConsultationCreateInput = z.infer<typeof outpatientConsultationCreateInput>;
