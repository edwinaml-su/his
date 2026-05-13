/**
 * §22 Nutrition — schemas de input (Wave 8 / Phase 2 entry).
 *
 * Skeleton mínimo. Cálculo automático de requerimiento calórico/proteico,
 * disparadores por valoración de riesgo y enlace con farmacia parenteral
 * viven en iteraciones siguientes.
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
const NUTRITION_ORDER_STATUS = [
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "ON_HOLD",
] as const;
const MALNUTRITION_RISK = ["LOW", "MODERATE", "HIGH"] as const;

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

export const nutritionAssessmentCreateInput = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  assessedById: z.string().uuid(),
  weightKg: z.number().min(0).max(500).optional(),
  heightCm: z.number().min(0).max(300).optional(),
  bmi: z.number().min(0).max(200).optional(),
  malnutritionRisk: malnutritionRiskEnum.optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const nutritionAssessmentListInput = z.object({
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  malnutritionRisk: malnutritionRiskEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
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

export type DietPlanCreateInput = z.infer<typeof dietPlanCreateInput>;
export type NutritionAssessmentCreateInput = z.infer<typeof nutritionAssessmentCreateInput>;
export type NutritionOrderCreateInput = z.infer<typeof nutritionOrderCreateInput>;
