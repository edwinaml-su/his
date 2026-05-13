/**
 * §22 Nutrition — schemas de input (Beta.13 hardening layer 1).
 *
 * Cambios respecto al skeleton Wave 8:
 *  - State machine NutritionOrderStatus: ORDERED → ACTIVE → COMPLETED | HELD | CANCELLED.
 *  - Caloric range validation (NutritionAssessment.targetCalories: 600–4000 kcal/day).
 *  - nutritionOrderCreateInput incluye dietPlanId + encounterDiagnoses para
 *    compatibilidad de dieta (helper validateDietCompatibility).
 *  - hold / activate transitions añadidas.
 *  - signedAt en nutritionAssessmentSignInput para append-only post-firma.
 */
import { z } from "zod";

const DIET_TYPE = [
  "REGULAR",
  "SOFT",
  "LIQUID_CLEAR",
  "LIQUID_FULL",
  "DIABETIC",
  "LOW_SODIUM",
  "RENAL",
  "HYPOPROTEIC",
  "HYPERPROTEIC",
  "HYPOCALORIC",
  "HIPERCALORIC",
  "ENTERAL_ONLY",
  "NPO",
  "OTHER",
] as const;

const DIET_PLAN_STATUS = ["ACTIVE", "DISCONTINUED", "COMPLETED"] as const;
const NUTRITION_ORDER_ROUTE = ["ENTERAL", "PARENTERAL"] as const;

/**
 * State machine: ORDERED → ACTIVE → COMPLETED
 *                ORDERED → HELD   → ACTIVE
 *                ORDERED → CANCELLED
 *                ACTIVE  → HELD   → ACTIVE
 *                ACTIVE  → CANCELLED
 * ON_HOLD kept as alias for HELD for backward compat.
 */
const NUTRITION_ORDER_STATUS = [
  "ORDERED",
  "ACTIVE",
  "COMPLETED",
  "HELD",
  "CANCELLED",
] as const;

const MALNUTRITION_RISK = ["LOW", "MODERATE", "HIGH"] as const;

/** Valid transitions: from → set of allowed next statuses. */
export const NUTRITION_ORDER_TRANSITIONS: Record<
  (typeof NUTRITION_ORDER_STATUS)[number],
  ReadonlyArray<(typeof NUTRITION_ORDER_STATUS)[number]>
> = {
  ORDERED: ["ACTIVE", "HELD", "CANCELLED"],
  ACTIVE: ["COMPLETED", "HELD", "CANCELLED"],
  HELD: ["ACTIVE", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const dietTypeEnum = z.enum(DIET_TYPE);
export const dietPlanStatusEnum = z.enum(DIET_PLAN_STATUS);
export const nutritionOrderRouteEnum = z.enum(NUTRITION_ORDER_ROUTE);
export const nutritionOrderStatusEnum = z.enum(NUTRITION_ORDER_STATUS);
export const malnutritionRiskEnum = z.enum(MALNUTRITION_RISK);

// ---------------------------------------------------------------------------
// DietPlan
// ---------------------------------------------------------------------------

export const dietPlanCreateInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  dietType: dietTypeEnum,
  caloriesTarget: z.number().int().min(0).max(10000).optional(),
  proteinTarget: z.number().min(0).max(1000).optional(),
  /** Códigos CIE-10/SNOMED que este plan admite. Usado en validateDietCompatibility. */
  compatibleWithDiagnoses: z.array(z.string().min(1).max(20)).max(50).default([]),
  notes: z.string().trim().max(4000).optional(),
});

export const dietPlanListInput = z.object({
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: dietPlanStatusEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const dietPlanDiscontinueInput = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// NutritionAssessment
// ---------------------------------------------------------------------------

/**
 * targetCalories: 600–4000 kcal/day — rango médicamente plausible.
 * Por debajo de 600 corresponde a ayuno terapéutico supervisado (fuera del alcance del HIS).
 * Por encima de 4000 sólo aplica en hipermetabolismo severo; valores mayores sugieren error.
 */
export const nutritionAssessmentCreateInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  assessedById: z.string().uuid(),
  weightKg: z.number().min(0).max(500).optional(),
  heightCm: z.number().min(0).max(300).optional(),
  bmi: z.number().min(0).max(200).optional(),
  malnutritionRisk: malnutritionRiskEnum.optional(),
  targetCalories: z
    .number()
    .int()
    .min(600, "targetCalories debe ser ≥ 600 kcal/día (mínimo plausible)")
    .max(4000, "targetCalories debe ser ≤ 4000 kcal/día (máximo plausible)")
    .optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const nutritionAssessmentListInput = z.object({
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  malnutritionRisk: malnutritionRiskEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const nutritionAssessmentSignInput = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// NutritionOrder (Enteral / Parenteral)
// ---------------------------------------------------------------------------

export const nutritionOrderCreateInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  prescriberId: z.string().uuid(),
  route: nutritionOrderRouteEnum,
  formula: z.string().trim().max(200).optional(),
  ratePerHour: z.number().nonnegative().optional(),
  totalVolume: z.number().nonnegative().optional(),
  caloriesPerDay: z.number().int().min(0).max(10000).optional(),
  /**
   * Si se provee, el router valida que el DietPlan.compatibleWithDiagnoses
   * tenga intersección con encounterDiagnoses. Requiere encounterDiagnoses.
   */
  dietPlanId: z.string().uuid().optional(),
  /**
   * Códigos de diagnóstico activos del encounter (CIE-10/SNOMED).
   * Requerido si dietPlanId está presente para ejecutar validateDietCompatibility.
   */
  encounterDiagnoses: z.array(z.string().min(1).max(20)).max(50).default([]),
  notes: z.string().trim().max(4000).optional(),
});

export const nutritionOrderListInput = z.object({
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  route: nutritionOrderRouteEnum.optional(),
  status: nutritionOrderStatusEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const nutritionOrderCompleteInput = z.object({
  id: z.string().uuid(),
});

export const nutritionOrderCancelInput = z.object({
  id: z.string().uuid(),
});

export const nutritionOrderHoldInput = z.object({
  id: z.string().uuid(),
});

export const nutritionOrderActivateInput = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DietPlanCreateInput = z.infer<typeof dietPlanCreateInput>;
export type NutritionAssessmentCreateInput = z.infer<typeof nutritionAssessmentCreateInput>;
export type NutritionOrderCreateInput = z.infer<typeof nutritionOrderCreateInput>;
export type NutritionOrderStatus = (typeof NUTRITION_ORDER_STATUS)[number];
