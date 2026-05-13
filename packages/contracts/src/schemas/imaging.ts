/**
 * §18 RIS/PACS (Imaging) — schemas de input.
 * Skeleton mínimo. Validación de accession numbers DICOM y reglas de
 * routing por modalidad viven en el router.
 */
import { z } from "zod";

const MODALITY_TYPE = [
  "CR",
  "CT",
  "MR",
  "US",
  "XA",
  "MG",
  "NM",
  "PT",
  "OTHER",
] as const;

const IMAGING_ORDER_STATUS = [
  "ORDERED",
  "SCHEDULED",
  "IN_PROGRESS",
  "ACQUIRED",
  "REPORTED",
  "CANCELLED",
] as const;

const IMAGING_PRIORITY = ["ROUTINE", "URGENT", "STAT"] as const;

export const imagingModalityTypeEnum = z.enum(MODALITY_TYPE);
export const imagingOrderStatusEnum = z.enum(IMAGING_ORDER_STATUS);
export const imagingPriorityEnum = z.enum(IMAGING_PRIORITY);

export type ImagingOrderStatusType = z.infer<typeof imagingOrderStatusEnum>;
export type ImagingPriorityType = z.infer<typeof imagingPriorityEnum>;

export const imagingModalityCreateInput = z.object({
  establishmentId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  modalityType: imagingModalityTypeEnum,
  aeTitle: z.string().trim().max(40).optional(),
});

export const imagingModalityListInput = z.object({
  establishmentId: z.string().uuid().optional(),
  modalityType: imagingModalityTypeEnum.optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const imagingOrderCreateInput = z.object({
  encounterId: z.string().uuid(),
  establishmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  modalityId: z.string().uuid().optional(),
  modalityType: imagingModalityTypeEnum,
  studyDescription: z.string().trim().min(1).max(400),
  bodySite: z.string().trim().max(120).optional(),
  clinicalIndication: z.string().trim().min(1).max(4000),
  priority: imagingPriorityEnum.default("ROUTINE"),
  scheduledAt: z.coerce.date().optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const imagingOrderListInput = z.object({
  status: imagingOrderStatusEnum.optional(),
  priority: imagingPriorityEnum.optional(),
  modalityType: imagingModalityTypeEnum.optional(),
  patientId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
  establishmentId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const imagingOrderUpdateStatusInput = z.object({
  id: z.string().uuid(),
  status: imagingOrderStatusEnum,
  accessionNumber: z.string().trim().max(80).optional(),
});

export const imagingOrderCancelInput = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(400),
});

export const imagingReportCreateInput = z.object({
  orderId: z.string().uuid(),
  findings: z.string().trim().min(1).max(16000),
  impression: z.string().trim().min(1).max(8000),
  recommendation: z.string().trim().max(4000).optional(),
});

export const imagingReportSignInput = z.object({
  orderId: z.string().uuid(),
});

export type ImagingModalityCreateInput = z.infer<typeof imagingModalityCreateInput>;
export type ImagingOrderCreateInput = z.infer<typeof imagingOrderCreateInput>;
export type ImagingOrderListInput = z.infer<typeof imagingOrderListInput>;
export type ImagingOrderUpdateStatusInput = z.infer<typeof imagingOrderUpdateStatusInput>;
export type ImagingReportCreateInput = z.infer<typeof imagingReportCreateInput>;
