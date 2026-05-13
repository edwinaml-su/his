/**
 * §18 RIS/PACS (Imaging) — schemas de input.
 * Beta.9 hardening layer 1: state machine validation, DICOM code enum,
 * urgency SLA derivation, report immutability inputs.
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

/**
 * DICOM standard modality codes (IOD C.7.3.1.1.1).
 * These are the values allowed in ImagingModality.dicomCode.
 */
export const DICOM_MODALITY = ["CT", "MR", "US", "XR", "MG", "NM", "PT", "DX", "RF"] as const;
export type DicomModalityCode = (typeof DICOM_MODALITY)[number];

/**
 * State machine transitions. COMPLETED and VALIDATED are new states in Beta.9.
 * Valid forward transitions:
 *   ORDERED → SCHEDULED → IN_PROGRESS → COMPLETED → REPORTED → VALIDATED
 *   Any of ORDERED/SCHEDULED/IN_PROGRESS → CANCELLED
 */
const IMAGING_ORDER_STATUS = [
  "ORDERED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "REPORTED",
  "VALIDATED",
  "CANCELLED",
] as const;

const IMAGING_PRIORITY = ["STAT", "URGENT", "ROUTINE"] as const;

export const imagingModalityTypeEnum = z.enum(MODALITY_TYPE);
export const dicomModalityEnum = z.enum(DICOM_MODALITY);
export const imagingOrderStatusEnum = z.enum(IMAGING_ORDER_STATUS);
export const imagingPriorityEnum = z.enum(IMAGING_PRIORITY);

export type ImagingOrderStatusType = z.infer<typeof imagingOrderStatusEnum>;
export type ImagingPriorityType = z.infer<typeof imagingPriorityEnum>;

/** SLA in minutes derived from priority. STAT=60, URGENT=240, ROUTINE=1440. */
export const SLA_MINUTES: Record<ImagingPriorityType, number> = {
  STAT: 60,
  URGENT: 240,
  ROUTINE: 1440,
};

/**
 * Valid forward transitions for the state machine.
 * Only these from→to pairs are accepted by updateStatus.
 */
export const VALID_STATUS_TRANSITIONS: Record<
  ImagingOrderStatusType,
  ImagingOrderStatusType[]
> = {
  ORDERED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["REPORTED"],
  REPORTED: ["VALIDATED"],
  VALIDATED: [],
  CANCELLED: [],
};

/** Modality types eligible for radiation dose tracking. */
export const RADIATION_DOSE_MODALITIES: (typeof MODALITY_TYPE)[number][] = [
  "CT",
  "XA",
  "MG",
] as const;

export const imagingModalityCreateInput = z.object({
  establishmentId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  modalityType: imagingModalityTypeEnum,
  dicomCode: dicomModalityEnum.optional(),
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

export const imagingOrderUpdateStatusInput = z
  .object({
    id: z.string().uuid(),
    status: imagingOrderStatusEnum,
    accessionNumber: z.string().trim().max(80).optional(),
    /** Radiation dose DAP (cGy·cm²) — only for CT/XA/MG modalities. */
    radiationDoseDap: z.number().positive().optional(),
    /** Radiation dose CTDIvol (mGy) — only for CT/XA/MG modalities. */
    radiationDoseCtdi: z.number().positive().optional(),
  })
  .refine(
    (d) => d.status !== "CANCELLED",
    "Use order.cancel to cancel an order.",
  );

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

export const imagingReportValidateInput = z.object({
  orderId: z.string().uuid(),
});

export type ImagingModalityCreateInput = z.infer<typeof imagingModalityCreateInput>;
export type ImagingOrderCreateInput = z.infer<typeof imagingOrderCreateInput>;
export type ImagingOrderListInput = z.infer<typeof imagingOrderListInput>;
export type ImagingOrderUpdateStatusInput = z.infer<typeof imagingOrderUpdateStatusInput>;
export type ImagingReportCreateInput = z.infer<typeof imagingReportCreateInput>;
export type ImagingReportValidateInput = z.infer<typeof imagingReportValidateInput>;
