/**
 * §21 Respiratory — schemas de input (Wave 8 / Beta.12 hardening layer 1).
 *
 * Beta.12 adds:
 *   - VentilatorSessionStatus enum (state machine: ACTIVE → WEANING → EXTUBATED …).
 *   - Medically-safe ranges for PEEP / FiO2 / RR / Vt enforced via Zod.
 *   - ventilatorSessionTransitionInput — explicit state-machine transitions.
 *   - respiratoryOrderRenewInput — extends order lifetime 24 h.
 *   - getExpiredOrders helper schema (query input).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enum constants
// ---------------------------------------------------------------------------

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

/**
 * Beta.12 — state machine values.
 * Valid transitions enforced at the router level:
 *   ACTIVE → WEANING → EXTUBATED
 *   WEANING → ESCALATED → ACTIVE
 *   WEANING → FAILED_EXTUBATION
 */
const VENTILATOR_SESSION_STATUS = [
  "ACTIVE",
  "WEANING",
  "EXTUBATED",
  "ESCALATED",
  "FAILED_EXTUBATION",
] as const;

export const respiratoryOrderTypeEnum = z.enum(RESPIRATORY_ORDER_TYPE);
export const respiratoryOrderStatusEnum = z.enum(RESPIRATORY_ORDER_STATUS);
export const ventilatorModeEnum = z.enum(VENTILATOR_MODE);
export const medicalGasTypeEnum = z.enum(MEDICAL_GAS_TYPE);
export const ventilatorSessionStatusEnum = z.enum(VENTILATOR_SESSION_STATUS);

// ---------------------------------------------------------------------------
// Medically-safe parameter ranges (Beta.12)
// ---------------------------------------------------------------------------

/**
 * PEEP: 5–20 cmH2O (standard ICU protective ventilation range).
 * Values outside this range require explicit clinical override (not in layer 1).
 */
export const PEEP_MIN = 5;
export const PEEP_MAX = 20;

/**
 * FiO2: 0.21–1.0 (room air to 100% O2) as a fraction, not percentage.
 * Note: the old schema stored this as percentage (21–100); Beta.12 normalises to fraction.
 */
export const FIO2_MIN = 0.21;
export const FIO2_MAX = 1.0;

/** RR: 8–30 breaths/min (adult safe range). */
export const RR_MIN = 8;
export const RR_MAX = 30;

/**
 * Tidal volume: expressed as mL/kg ideal body weight.
 * Safe range: 4–12 mL/kg. Absolute mL stored in DB; /kg validation lives in router.
 * The Zod schema validates absolute mL (50–1500 mL covers all practical body weights).
 */
export const VT_ABS_MIN = 50;
export const VT_ABS_MAX = 1500;

// ---------------------------------------------------------------------------
// RespiratoryOrder
// ---------------------------------------------------------------------------

export const respiratoryOrderCreateInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  prescriberId: z.string().uuid(),
  type: respiratoryOrderTypeEnum,
  flowRate: z.number().nonnegative().optional(),
  /** Stored as 0–100 percentage in DB (legacy contract preserved). */
  fio2: z.number().min(21).max(100).optional(),
  notes: z.string().trim().max(4000).optional(),
  /** Beta.12: optional explicit expiry; defaults to now()+24h in the router. */
  expiresAt: z.coerce.date().optional(),
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

/** Beta.12 — renew an order, resetting expiresAt to now()+24 h. */
export const respiratoryOrderRenewInput = z.object({
  id: z.string().uuid(),
});

/** Beta.12 — query orders past their expiresAt without a subsequent renewal. */
export const getExpiredOrdersInput = z.object({
  organizationId: z.string().uuid().optional(),
  asOf: z.coerce.date().optional(), // defaults to now() in the router
  limit: z.number().int().min(1).max(500).default(100),
});

// ---------------------------------------------------------------------------
// VentilatorSession
// ---------------------------------------------------------------------------

/**
 * Beta.12 — ventilator parameters with medically-safe ranges.
 *
 * FiO2 is accepted as a fraction (0.21–1.0) at this layer.
 * PEEP in cmH2O, RR in breaths/min, tidalVolume in absolute mL.
 */
export const ventilatorParamsSchema = z.object({
  peep: z.number().min(PEEP_MIN).max(PEEP_MAX).optional(),
  fio2: z.number().min(FIO2_MIN).max(FIO2_MAX).optional(),
  rrSet: z.number().int().min(RR_MIN).max(RR_MAX).optional(),
  tidalVolume: z.number().min(VT_ABS_MIN).max(VT_ABS_MAX).optional(),
  patientWeightKg: z.number().positive().max(300).optional(),
});

export const ventilatorSessionCreateInput = ventilatorParamsSchema.extend({
  orderId: z.string().uuid(),
  mode: ventilatorModeEnum,
  notes: z.string().trim().max(4000).optional(),
});

export const ventilatorSessionEndInput = z.object({
  id: z.string().uuid(),
});

export const ventilatorSessionListInput = z.object({
  orderId: z.string().uuid().optional(),
  statusSM: ventilatorSessionStatusEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

/**
 * Beta.12 — explicit state-machine transition.
 *
 * Allowed graph (enforced at router, not in Zod):
 *   ACTIVE          → WEANING
 *   WEANING         → EXTUBATED | ESCALATED | FAILED_EXTUBATION
 *   ESCALATED       → ACTIVE
 */
export const ventilatorSessionTransitionInput = z.object({
  id: z.string().uuid(),
  to: ventilatorSessionStatusEnum,
  notes: z.string().trim().max(4000).optional(),
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

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type RespiratoryOrderCreateInput = z.infer<typeof respiratoryOrderCreateInput>;
export type VentilatorSessionCreateInput = z.infer<typeof ventilatorSessionCreateInput>;
export type VentilatorSessionTransitionInput = z.infer<typeof ventilatorSessionTransitionInput>;
export type MedicalGasUsageCreateInput = z.infer<typeof medicalGasUsageCreateInput>;
export type GetExpiredOrdersInput = z.infer<typeof getExpiredOrdersInput>;
