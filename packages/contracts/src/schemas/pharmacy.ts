/**
 * §15 Pharmacy — schemas de input.
 * Skeleton mínimo. UI + RLS + tests en commits posteriores.
 */
import { z } from "zod";

const PHARM_FORM = [
  "TABLET",
  "CAPSULE",
  "SYRUP",
  "INJECTION",
  "CREAM",
  "OINTMENT",
  "DROPS",
  "INHALER",
  "SUPPOSITORY",
  "PATCH",
  "OTHER",
] as const;

const DISPENSING_CLASS = ["OTC", "RX", "RX_CONTROLLED"] as const;

const ADMIN_ROUTE = [
  "ORAL",
  "IV",
  "IM",
  "SC",
  "TOPICAL",
  "INHALED",
  "RECTAL",
  "SUBLINGUAL",
  "OPHTHALMIC",
  "OTIC",
  "NASAL",
] as const;

export const pharmaceuticalFormEnum = z.enum(PHARM_FORM);
export const dispensingClassEnum = z.enum(DISPENSING_CLASS);
export const adminRouteEnum = z.enum(ADMIN_ROUTE);

export const drugListInput = z.object({
  search: z.string().trim().max(120).optional(),
  dispensingClass: dispensingClassEnum.optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const drugCreateInput = z.object({
  organizationId: z.string().uuid().nullable().default(null),
  genericName: z.string().trim().min(1).max(200),
  brandName: z.string().trim().max(200).optional(),
  atcCode: z.string().trim().max(20).optional(),
  pharmaceuticalForm: pharmaceuticalFormEnum,
  strengthValue: z.number().positive(),
  strengthUnit: z.string().trim().min(1).max(20),
  dispensingClass: dispensingClassEnum.default("RX"),
  requiresControlledLog: z.boolean().default(false),
});

export const prescriptionItemInput = z.object({
  drugId: z.string().uuid(),
  dosage: z.string().trim().min(1).max(120),
  route: adminRouteEnum,
  frequency: z.string().trim().min(1).max(80),
  durationDays: z.number().int().min(1).max(365).optional(),
  prnAsNeeded: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional(),
});

export const prescriptionCreateInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  notes: z.string().trim().max(4000).optional(),
  items: z.array(prescriptionItemInput).min(1).max(50),
});

export const prescriptionSignInput = z.object({
  id: z.string().uuid(),
});

export const prescriptionListInput = z.object({
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  prescriberId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const dispenseCreateInput = z.object({
  prescriptionItemId: z.string().uuid(),
  quantity: z.number().positive(),
  batchNumber: z.string().trim().max(80).optional(),
  expiryDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type DrugListInput = z.infer<typeof drugListInput>;
export type DrugCreateInput = z.infer<typeof drugCreateInput>;
export type PrescriptionCreateInput = z.infer<typeof prescriptionCreateInput>;
export type PrescriptionSignInput = z.infer<typeof prescriptionSignInput>;
export type PrescriptionListInput = z.infer<typeof prescriptionListInput>;
export type DispenseCreateInput = z.infer<typeof dispenseCreateInput>;
