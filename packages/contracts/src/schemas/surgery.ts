/**
 * §13 Surgery (Quirófano) — schemas de input.
 * Skeleton mínimo. Detección de solape de OR, validación de personal
 * y time-out workflow exhaustivo viven en el router.
 */
import { z } from "zod";

const SURGERY_STATUS = [
  "SCHEDULED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "POSTPONED",
] as const;

const ASA_CLASS = [
  "ASA_I",
  "ASA_II",
  "ASA_III",
  "ASA_IV",
  "ASA_V",
  "ASA_VI",
] as const;

export const surgeryCaseStatusEnum = z.enum(SURGERY_STATUS);
export const asaClassEnum = z.enum(ASA_CLASS);

export type SurgeryCaseStatusType = z.infer<typeof surgeryCaseStatusEnum>;

export const operatingRoomCreateInput = z.object({
  establishmentId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
});

export const operatingRoomListInput = z.object({
  establishmentId: z.string().uuid().optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const surgeryCaseCreateInput = z
  .object({
    encounterId: z.string().uuid(),
    establishmentId: z.string().uuid(),
    patientId: z.string().uuid(),
    primarySurgeonId: z.string().uuid(),
    operatingRoomId: z.string().uuid().optional(),
    procedureDescription: z.string().trim().min(1).max(400),
    procedureCode: z.string().trim().max(40).optional(),
    scheduledStart: z.coerce.date(),
    scheduledEnd: z.coerce.date(),
    asaClass: asaClassEnum.optional(),
    preopNotes: z.string().trim().max(4000).optional(),
  })
  .refine((d) => d.scheduledEnd > d.scheduledStart, {
    message: "scheduledEnd debe ser posterior a scheduledStart",
    path: ["scheduledEnd"],
  });

export const surgeryCaseListInput = z.object({
  status: surgeryCaseStatusEnum.optional(),
  primarySurgeonId: z.string().uuid().optional(),
  operatingRoomId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const surgeryCaseTimeOutInput = z.object({
  id: z.string().uuid(),
});

export const surgeryCaseStartInput = z.object({
  id: z.string().uuid(),
});

export const surgeryCaseCompleteInput = z.object({
  id: z.string().uuid(),
  intraopNotes: z.string().trim().max(8000).optional(),
  postopNotes: z.string().trim().max(8000).optional(),
});

export const surgeryCaseCancelInput = z.object({
  id: z.string().uuid(),
  cancelReason: z.string().trim().min(1).max(400),
});

export type OperatingRoomCreateInput = z.infer<typeof operatingRoomCreateInput>;
export type SurgeryCaseCreateInput = z.infer<typeof surgeryCaseCreateInput>;
export type SurgeryCaseListInput = z.infer<typeof surgeryCaseListInput>;
export type SurgeryCaseCancelInput = z.infer<typeof surgeryCaseCancelInput>;
export type SurgeryCaseCompleteInput = z.infer<typeof surgeryCaseCompleteInput>;
