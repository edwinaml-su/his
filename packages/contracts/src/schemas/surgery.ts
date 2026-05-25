/**
 * §13 Surgery (Quirófano) — schemas de input.
 * Beta.6 hardening layer 1: WHO checklist, state machine, OR conflict,
 * anesthesia tracking.
 */
import { z } from "zod";

const SURGERY_STATUS = [
  "SCHEDULED",
  "CONFIRMED",
  "IN_PROGRESS",
  "POST_OP",
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

const ANESTHESIA_TYPE = [
  "GENERAL",
  "REGIONAL",
  "LOCAL",
  "SEDATION",
  "NONE",
] as const;

export const surgeryCaseStatusEnum = z.enum(SURGERY_STATUS);
export const asaClassEnum = z.enum(ASA_CLASS);
export const anesthesiaTypeEnum = z.enum(ANESTHESIA_TYPE);

export type SurgeryCaseStatusType = z.infer<typeof surgeryCaseStatusEnum>;
export type AnesthesiaTypeType = z.infer<typeof anesthesiaTypeEnum>;

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
    costCenterId: z.string().uuid().optional(),
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
  costCenterId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

// WHO checklist inputs — each phase records who performed it (user from ctx)
export const surgeryCaseSignInInput = z.object({
  id: z.string().uuid(),
});

export const surgeryCaseTimeOutInput = z.object({
  id: z.string().uuid(),
});

export const surgeryCaseSignOutInput = z.object({
  id: z.string().uuid(),
});

export const surgeryCaseStartInput = z.object({
  id: z.string().uuid(),
});

export const surgeryCasePostOpInput = z.object({
  id: z.string().uuid(),
  intraopNotes: z.string().trim().max(8000).optional(),
});

export const surgeryCaseCompleteInput = z.object({
  id: z.string().uuid(),
  postopNotes: z.string().trim().max(8000).optional(),
});

export const surgeryCaseCancelInput = z.object({
  id: z.string().uuid(),
  cancelReason: z.string().trim().min(1).max(400),
});

export const surgeryCasePostponeInput = z.object({
  id: z.string().uuid(),
  cancelReason: z.string().trim().min(1).max(400),
  newScheduledStart: z.coerce.date(),
  newScheduledEnd: z.coerce.date(),
});

export const surgeryCaseAnesthesiaInput = z
  .object({
    id: z.string().uuid(),
    anesthesiaType: anesthesiaTypeEnum,
    anesthesiaStartAt: z.coerce.date(),
    anesthesiaEndAt: z.coerce.date().optional(),
  })
  .refine(
    (d) => d.anesthesiaEndAt === undefined || d.anesthesiaEndAt > d.anesthesiaStartAt,
    {
      message: "anesthesiaEndAt debe ser posterior a anesthesiaStartAt",
      path: ["anesthesiaEndAt"],
    },
  );

export const INTRAOP_ENTRY_TYPE = ["COMPLICATION", "NOTE"] as const;
export const intraopEntryTypeEnum = z.enum(INTRAOP_ENTRY_TYPE);

export const surgeryCaseUpdateIntraopNotesInput = z.object({
  id: z.string().uuid(),
  appendText: z.string().trim().min(1).max(2000),
  entryType: intraopEntryTypeEnum.default("NOTE"),
});

export type SurgeryCaseUpdateIntraopNotesInput = z.infer<typeof surgeryCaseUpdateIntraopNotesInput>;

export type OperatingRoomCreateInput = z.infer<typeof operatingRoomCreateInput>;
export type SurgeryCaseCreateInput = z.infer<typeof surgeryCaseCreateInput>;
export type SurgeryCaseListInput = z.infer<typeof surgeryCaseListInput>;
export type SurgeryCaseCancelInput = z.infer<typeof surgeryCaseCancelInput>;
export type SurgeryCaseCompleteInput = z.infer<typeof surgeryCaseCompleteInput>;
export type SurgeryCaseAnesthesiaInput = z.infer<typeof surgeryCaseAnesthesiaInput>;
