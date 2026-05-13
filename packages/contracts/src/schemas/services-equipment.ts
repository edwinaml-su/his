/**
 * §20 Services & Equipment — schemas de input (Wave 8 / Phase 2 entry).
 *
 * Skeleton mínimo. Reglas de programación recurrente de PM (mantenimiento
 * preventivo) y workflows de aprobación post-fallo viven en el router.
 */
import { z } from "zod";

const EQUIPMENT_STATUS = [
  "OPERATIONAL",
  "UNDER_MAINTENANCE",
  "OUT_OF_SERVICE",
  "RETIRED",
] as const;

const PM_SCHEDULE_STATUS = [
  "PLANNED",
  "COMPLETED",
  "OVERDUE",
  "CANCELLED",
] as const;

const CALIBRATION_RESULT = ["PASS", "FAIL", "CONDITIONAL"] as const;

export const equipmentStatusEnum = z.enum(EQUIPMENT_STATUS);
export const pmScheduleStatusEnum = z.enum(PM_SCHEDULE_STATUS);
export const calibrationResultEnum = z.enum(CALIBRATION_RESULT);

export type EquipmentStatusType = z.infer<typeof equipmentStatusEnum>;
export type PmScheduleStatusType = z.infer<typeof pmScheduleStatusEnum>;

// ---------------------------------------------------------------------------
// BiomedicalEquipment
// ---------------------------------------------------------------------------

export const equipmentCreateInput = z.object({
  establishmentId: z.string().uuid(),
  assetTag: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  manufacturer: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  serialNumber: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  installDate: z.coerce.date().optional(),
});

export const equipmentListInput = z.object({
  establishmentId: z.string().uuid().optional(),
  status: equipmentStatusEnum.optional(),
  category: z.string().trim().max(80).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
});

export const equipmentSetStatusInput = z.object({
  id: z.string().uuid(),
  status: equipmentStatusEnum,
});

// ---------------------------------------------------------------------------
// PmSchedule
// ---------------------------------------------------------------------------

export const pmScheduleCreateInput = z.object({
  equipmentId: z.string().uuid(),
  scheduledAt: z.coerce.date(),
  taskNotes: z.string().trim().max(2000).optional(),
});

export const pmScheduleListInput = z.object({
  equipmentId: z.string().uuid().optional(),
  status: pmScheduleStatusEnum.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const pmScheduleCompleteInput = z.object({
  id: z.string().uuid(),
  taskNotes: z.string().trim().max(2000).optional(),
});

export const pmScheduleCancelInput = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// CalibrationLog
// ---------------------------------------------------------------------------

export const calibrationLogCreateInput = z
  .object({
    equipmentId: z.string().uuid(),
    calibratedAt: z.coerce.date(),
    externalAgency: z.string().trim().max(200).optional(),
    certificateRef: z.string().trim().max(80).optional(),
    result: calibrationResultEnum,
    nextDueAt: z.coerce.date().optional(),
    notes: z.string().trim().max(4000).optional(),
  })
  .refine((d) => !d.nextDueAt || d.nextDueAt > d.calibratedAt, {
    message: "nextDueAt debe ser posterior a calibratedAt",
    path: ["nextDueAt"],
  });

export const calibrationLogListInput = z.object({
  equipmentId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type EquipmentCreateInput = z.infer<typeof equipmentCreateInput>;
export type PmScheduleCreateInput = z.infer<typeof pmScheduleCreateInput>;
export type CalibrationLogCreateInput = z.infer<typeof calibrationLogCreateInput>;
