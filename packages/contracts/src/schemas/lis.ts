/**
 * §17 LIS — schemas de input. Skeleton mínimo.
 */
import { z } from "zod";

const SPECIMEN_TYPE = ["BLOOD", "URINE", "STOOL", "CSF", "SWAB", "TISSUE", "SALIVA", "OTHER"] as const;
const LAB_PRIORITY = ["ROUTINE", "URGENT", "STAT"] as const;
const LAB_ORDER_STATUS = ["DRAFT", "ORDERED", "COLLECTED", "IN_PROCESS", "RESULTED", "VALIDATED", "CANCELLED"] as const;
const SPECIMEN_CONDITION = ["ACCEPTABLE", "REJECTED", "HEMOLYZED", "CLOTTED", "INSUFFICIENT"] as const;
const RESULT_FLAG = ["NORMAL", "LOW", "HIGH", "CRITICAL_LOW", "CRITICAL_HIGH", "ABNORMAL"] as const;

export const specimenTypeEnum = z.enum(SPECIMEN_TYPE);
export const labPriorityEnum = z.enum(LAB_PRIORITY);
export const labOrderStatusEnum = z.enum(LAB_ORDER_STATUS);
export const specimenConditionEnum = z.enum(SPECIMEN_CONDITION);
export const resultFlagEnum = z.enum(RESULT_FLAG);

export const labPanelListInput = z.object({
  search: z.string().trim().max(120).optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const labTestListInput = z.object({
  panelId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const labOrderItemInput = z.object({
  testId: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
});

export const labOrderCreateInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  priority: labPriorityEnum.default("ROUTINE"),
  clinicalIndication: z.string().trim().max(2000).optional(),
  items: z.array(labOrderItemInput).min(1).max(50),
});

export const labOrderListInput = z.object({
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  priority: labPriorityEnum.optional(),
  status: labOrderStatusEnum.optional(),
  fromDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const specimenCollectInput = z.object({
  orderId: z.string().uuid(),
  type: specimenTypeEnum,
  barcode: z.string().trim().min(1).max(80),
  collectedAt: z.coerce.date().optional(),
});

export const specimenRejectInput = z.object({
  id: z.string().uuid(),
  rejectionReason: z.string().trim().min(1).max(400),
});

export const resultEnterInput = z.object({
  orderItemId: z.string().uuid(),
  specimenId: z.string().uuid().optional(),
  valueNumeric: z.number().optional(),
  valueText: z.string().trim().max(800).optional(),
  valueUnit: z.string().trim().max(40).optional(),
  flag: resultFlagEnum.default("NORMAL"),
  notes: z.string().trim().max(2000).optional(),
});

export const resultValidateInput = z.object({
  resultId: z.string().uuid(),
});

export type LabOrderCreateInput = z.infer<typeof labOrderCreateInput>;
export type LabOrderListInput = z.infer<typeof labOrderListInput>;
export type SpecimenCollectInput = z.infer<typeof specimenCollectInput>;
export type ResultEnterInput = z.infer<typeof resultEnterInput>;
