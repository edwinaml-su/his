/**
 * §21 Respiratory — schemas de input (Wave 8 / Phase 2 entry).
 *
 * Skeleton mínimo. Algoritmos de destete (weaning) y alertas por
 * desaturación viven en el router/servicio dedicado.
 */
import { z } from "zod";

const RESPIRATORY_ORDER_TYPE = [
  "OXYGEN_THERAPY",
  "MECHANICAL_VENT",
  "NEBULIZATION",
  "AEROSOL",
  "CPAP_BIPAP",
  "CHEST_PHYSIO",
] as const;

const RESPIRATORY_ORDER_STATUS = [
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "ON_HOLD",
] as const;

const VENTILATOR_MODE = [
  "AC",
  "SIMV",
  "PSV",
  "CPAP",
  "BIPAP",
  "PRVC",
  "OTHER",
] as const;

const MEDICAL_GAS_TYPE = ["O2", "AIR", "N2O", "CO2", "HELIOX"] as const;

export const respiratoryOrderTypeEnum = z.enum(RESPIRATORY_ORDER_TYPE);
export const respiratoryOrderStatusEnum = z.enum(RESPIRATORY_ORDER_STATUS);
export const ventilatorModeEnum = z.enum(VENTILATOR_MODE);
export const medicalGasTypeEnum = z.enum(MEDICAL_GAS_TYPE);

// ---------------------------------------------------------------------------
// RespiratoryOrder
// ---------------------------------------------------------------------------

export const respiratoryOrderCreateInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  prescriberId: z.string().uuid(),
  type: respiratoryOrderTypeEnum,
  flowRate: z.number().nonnegative().optional(),
  fio2: z.number().min(21).max(100).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const respiratoryOrderListInput = z.object({
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: respiratoryOrderStatusEnum.optional(),
  type: respiratoryOrderTypeEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const respiratoryOrderCompleteInput = z.object({
  id: z.string().uuid(),
});

export const respiratoryOrderCancelInput = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// VentilatorSession
// ---------------------------------------------------------------------------

export const ventilatorSessionCreateInput = z.object({
  orderId: z.string().uuid(),
  mode: ventilatorModeEnum,
  tidalVolume: z.number().nonnegative().optional(),
  rrSet: z.number().int().min(0).max(60).optional(),
  peep: z.number().nonnegative().optional(),
  fio2: z.number().min(21).max(100).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const ventilatorSessionEndInput = z.object({
  id: z.string().uuid(),
});

export const ventilatorSessionListInput = z.object({
  orderId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// MedicalGasUsage
// ---------------------------------------------------------------------------

export const medicalGasUsageCreateInput = z.object({
  orderId: z.string().uuid(),
  gasType: medicalGasTypeEnum,
  volumeLiters: z.number().positive(),
  notes: z.string().trim().max(400).optional(),
});

export const medicalGasUsageListInput = z.object({
  orderId: z.string().uuid().optional(),
  gasType: medicalGasTypeEnum.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export type RespiratoryOrderCreateInput = z.infer<typeof respiratoryOrderCreateInput>;
export type VentilatorSessionCreateInput = z.infer<typeof ventilatorSessionCreateInput>;
export type MedicalGasUsageCreateInput = z.infer<typeof medicalGasUsageCreateInput>;
