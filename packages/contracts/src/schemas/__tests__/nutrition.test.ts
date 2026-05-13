/**
 * Tests del schema §22 Nutrition — Beta.13 hardening layer 1.
 */
import { describe, it, expect } from "vitest";
import {
  dietTypeEnum,
  dietPlanStatusEnum,
  nutritionOrderRouteEnum,
  nutritionOrderStatusEnum,
  malnutritionRiskEnum,
  dietPlanCreateInput,
  dietPlanListInput,
  dietPlanDiscontinueInput,
  nutritionAssessmentCreateInput,
  nutritionAssessmentListInput,
  nutritionAssessmentSignInput,
  nutritionOrderCreateInput,
  nutritionOrderListInput,
  nutritionOrderCompleteInput,
  nutritionOrderCancelInput,
  nutritionOrderHoldInput,
  nutritionOrderActivateInput,
  NUTRITION_ORDER_TRANSITIONS,
} from "../nutrition";

const u = "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe("enums", () => {
  it.each([
    "REGULAR",
    "SOFT",
    "LIQUID_CLEAR",
    "DIABETIC",
    "NPO",
    "ENTERAL_ONLY",
  ])("diet %s válido", (t) =>
    expect(dietTypeEnum.safeParse(t).success).toBe(true),
  );

  it("diet FOO inválido", () =>
    expect(dietTypeEnum.safeParse("FOO").success).toBe(false));

  it.each(["ACTIVE", "DISCONTINUED", "COMPLETED"])("plan status %s válido", (s) =>
    expect(dietPlanStatusEnum.safeParse(s).success).toBe(true),
  );

  it.each(["ENTERAL", "PARENTERAL"])("route %s válido", (r) =>
    expect(nutritionOrderRouteEnum.safeParse(r).success).toBe(true),
  );

  it.each(["ORDERED", "ACTIVE", "COMPLETED", "HELD", "CANCELLED"])(
    "order status %s válido",
    (s) => expect(nutritionOrderStatusEnum.safeParse(s).success).toBe(true),
  );

  it("ON_HOLD ya no es status válido (reemplazado por HELD)", () =>
    expect(nutritionOrderStatusEnum.safeParse("ON_HOLD").success).toBe(false));

  it.each(["LOW", "MODERATE", "HIGH"])("malnutrition risk %s válido", (r) =>
    expect(malnutritionRiskEnum.safeParse(r).success).toBe(true),
  );
});

// ---------------------------------------------------------------------------
// State machine transitions
// ---------------------------------------------------------------------------

describe("NUTRITION_ORDER_TRANSITIONS", () => {
  it("ORDERED permite ACTIVE, HELD, CANCELLED", () => {
    expect(NUTRITION_ORDER_TRANSITIONS.ORDERED).toContain("ACTIVE");
    expect(NUTRITION_ORDER_TRANSITIONS.ORDERED).toContain("HELD");
    expect(NUTRITION_ORDER_TRANSITIONS.ORDERED).toContain("CANCELLED");
  });

  it("ACTIVE permite COMPLETED, HELD, CANCELLED", () => {
    expect(NUTRITION_ORDER_TRANSITIONS.ACTIVE).toContain("COMPLETED");
    expect(NUTRITION_ORDER_TRANSITIONS.ACTIVE).toContain("HELD");
    expect(NUTRITION_ORDER_TRANSITIONS.ACTIVE).toContain("CANCELLED");
  });

  it("ACTIVE no permite volver a ORDERED", () =>
    expect(NUTRITION_ORDER_TRANSITIONS.ACTIVE).not.toContain("ORDERED"));

  it("HELD permite ACTIVE y CANCELLED", () => {
    expect(NUTRITION_ORDER_TRANSITIONS.HELD).toContain("ACTIVE");
    expect(NUTRITION_ORDER_TRANSITIONS.HELD).toContain("CANCELLED");
  });

  it("HELD no permite COMPLETED directamente", () =>
    expect(NUTRITION_ORDER_TRANSITIONS.HELD).not.toContain("COMPLETED"));

  it("COMPLETED y CANCELLED son estados terminales", () => {
    expect(NUTRITION_ORDER_TRANSITIONS.COMPLETED).toHaveLength(0);
    expect(NUTRITION_ORDER_TRANSITIONS.CANCELLED).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DietPlan
// ---------------------------------------------------------------------------

describe("dietPlanCreateInput", () => {
  it("acepta input mínimo", () =>
    expect(
      dietPlanCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        dietType: "DIABETIC",
      }).success,
    ).toBe(true));

  it("compatibleWithDiagnoses por defecto []", () => {
    const r = dietPlanCreateInput.safeParse({
      encounterId: u,
      patientId: u,
      dietType: "RENAL",
    });
    expect(r.success && r.data.compatibleWithDiagnoses).toEqual([]);
  });

  it("acepta compatibleWithDiagnoses con códigos válidos", () =>
    expect(
      dietPlanCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        dietType: "RENAL",
        compatibleWithDiagnoses: ["N18.3", "E11"],
      }).success,
    ).toBe(true));

  it("rechaza caloriesTarget negativo", () =>
    expect(
      dietPlanCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        dietType: "REGULAR",
        caloriesTarget: -100,
      }).success,
    ).toBe(false));

  it("rechaza caloriesTarget > 10000", () =>
    expect(
      dietPlanCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        dietType: "REGULAR",
        caloriesTarget: 99999,
      }).success,
    ).toBe(false));

  it("rechaza proteinTarget negativo", () =>
    expect(
      dietPlanCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        dietType: "REGULAR",
        proteinTarget: -10,
      }).success,
    ).toBe(false));
});

describe("dietPlanListInput", () => {
  it("default limit=50", () => {
    const r = dietPlanListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });
});

describe("dietPlanDiscontinueInput", () => {
  it("requiere uuid", () =>
    expect(dietPlanDiscontinueInput.safeParse({ id: "abc" }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// NutritionAssessment — caloric range validation
// ---------------------------------------------------------------------------

describe("nutritionAssessmentCreateInput — targetCalories", () => {
  const base = { encounterId: u, patientId: u, assessedById: u };

  it("acepta targetCalories en rango válido (600–4000)", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({ ...base, targetCalories: 2000 }).success,
    ).toBe(true));

  it("acepta exactamente 600 kcal (límite inferior)", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({ ...base, targetCalories: 600 }).success,
    ).toBe(true));

  it("acepta exactamente 4000 kcal (límite superior)", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({ ...base, targetCalories: 4000 }).success,
    ).toBe(true));

  it("rechaza targetCalories < 600 (clínicamente inviable)", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({ ...base, targetCalories: 599 }).success,
    ).toBe(false));

  it("rechaza targetCalories > 4000 (error probable)", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({ ...base, targetCalories: 4001 }).success,
    ).toBe(false));

  it("targetCalories es opcional", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse(base).success,
    ).toBe(true));

  it("acepta input completo con todos los campos", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({
        ...base,
        weightKg: 75.5,
        heightCm: 170,
        bmi: 26.1,
        malnutritionRisk: "LOW",
        targetCalories: 1800,
      }).success,
    ).toBe(true));

  it("rechaza weightKg > 500", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({ ...base, weightKg: 600 }).success,
    ).toBe(false));

  it("rechaza heightCm negativo", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({ ...base, heightCm: -10 }).success,
    ).toBe(false));
});

describe("nutritionAssessmentListInput", () => {
  it("filtra por malnutritionRisk", () =>
    expect(
      nutritionAssessmentListInput.safeParse({ malnutritionRisk: "HIGH" }).success,
    ).toBe(true));
});

describe("nutritionAssessmentSignInput", () => {
  it("requiere uuid", () =>
    expect(nutritionAssessmentSignInput.safeParse({ id: u }).success).toBe(true));
  it("rechaza non-uuid", () =>
    expect(nutritionAssessmentSignInput.safeParse({ id: "abc" }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// NutritionOrder — diet plan + exclusivity inputs
// ---------------------------------------------------------------------------

describe("nutritionOrderCreateInput", () => {
  const base = { encounterId: u, patientId: u, prescriberId: u };

  it("acepta orden ENTERAL mínima", () =>
    expect(
      nutritionOrderCreateInput.safeParse({ ...base, route: "ENTERAL" }).success,
    ).toBe(true));

  it("acepta orden PARENTERAL con dietPlanId y encounterDiagnoses", () =>
    expect(
      nutritionOrderCreateInput.safeParse({
        ...base,
        route: "PARENTERAL",
        formula: "TPN base + lípidos",
        caloriesPerDay: 1800,
        totalVolume: 2000,
        dietPlanId: u,
        encounterDiagnoses: ["E11", "N18.3"],
      }).success,
    ).toBe(true));

  it("encounterDiagnoses por defecto []", () => {
    const r = nutritionOrderCreateInput.safeParse({ ...base, route: "ENTERAL" });
    expect(r.success && r.data.encounterDiagnoses).toEqual([]);
  });

  it("rechaza ratePerHour negativo", () =>
    expect(
      nutritionOrderCreateInput.safeParse({ ...base, route: "ENTERAL", ratePerHour: -10 }).success,
    ).toBe(false));

  it("rechaza route inválido", () =>
    expect(
      nutritionOrderCreateInput.safeParse({ ...base, route: "ORAL" }).success,
    ).toBe(false));

  it("rechaza dietPlanId no-uuid", () =>
    expect(
      nutritionOrderCreateInput.safeParse({ ...base, route: "ENTERAL", dietPlanId: "bad" }).success,
    ).toBe(false));
});

describe("nutritionOrderListInput", () => {
  it("default limit=50", () => {
    const r = nutritionOrderListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });
});

describe("nutritionOrder transition inputs", () => {
  it("complete + cancel + hold + activate requieren uuid", () => {
    expect(nutritionOrderCompleteInput.safeParse({ id: u }).success).toBe(true);
    expect(nutritionOrderCancelInput.safeParse({ id: "abc" }).success).toBe(false);
    expect(nutritionOrderHoldInput.safeParse({ id: u }).success).toBe(true);
    expect(nutritionOrderActivateInput.safeParse({ id: u }).success).toBe(true);
  });
});
