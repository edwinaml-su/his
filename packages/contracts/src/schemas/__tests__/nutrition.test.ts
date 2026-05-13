/**
 * Tests del schema §22 Nutrition (Wave 8).
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
  nutritionOrderCreateInput,
  nutritionOrderListInput,
  nutritionOrderCompleteInput,
  nutritionOrderCancelInput,
} from "../nutrition";

const u = "00000000-0000-0000-0000-000000000001";

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

  it.each(["ACTIVE", "COMPLETED", "CANCELLED", "ON_HOLD"])(
    "order status %s válido",
    (s) => expect(nutritionOrderStatusEnum.safeParse(s).success).toBe(true),
  );

  it.each(["LOW", "MODERATE", "HIGH"])("malnutrition risk %s válido", (r) =>
    expect(malnutritionRiskEnum.safeParse(r).success).toBe(true),
  );
});

describe("dietPlanCreateInput / list / discontinue", () => {
  it("acepta input mínimo", () =>
    expect(
      dietPlanCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        dietType: "DIABETIC",
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

  it("list default limit=50", () => {
    const r = dietPlanListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("discontinue requiere uuid", () =>
    expect(dietPlanDiscontinueInput.safeParse({ id: "abc" }).success).toBe(false));
});

describe("nutritionAssessmentCreateInput / list", () => {
  it("acepta input válido", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        assessedById: u,
        weightKg: 75.5,
        heightCm: 170,
        bmi: 26.1,
        malnutritionRisk: "LOW",
      }).success,
    ).toBe(true));

  it("rechaza weightKg > 500", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        assessedById: u,
        weightKg: 600,
      }).success,
    ).toBe(false));

  it("rechaza heightCm negativo", () =>
    expect(
      nutritionAssessmentCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        assessedById: u,
        heightCm: -10,
      }).success,
    ).toBe(false));

  it("list filtra por malnutritionRisk", () =>
    expect(
      nutritionAssessmentListInput.safeParse({ malnutritionRisk: "HIGH" }).success,
    ).toBe(true));
});

describe("nutritionOrderCreateInput / list / complete / cancel", () => {
  it("acepta orden ENTERAL", () =>
    expect(
      nutritionOrderCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "ENTERAL",
        formula: "Ensure Plus",
        ratePerHour: 60,
      }).success,
    ).toBe(true));

  it("acepta orden PARENTERAL", () =>
    expect(
      nutritionOrderCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "PARENTERAL",
        formula: "TPN base + lípidos",
        caloriesPerDay: 1800,
        totalVolume: 2000,
      }).success,
    ).toBe(true));

  it("rechaza ratePerHour negativo", () =>
    expect(
      nutritionOrderCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "ENTERAL",
        ratePerHour: -10,
      }).success,
    ).toBe(false));

  it("rechaza route inválido", () =>
    expect(
      nutritionOrderCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "ORAL",
      }).success,
    ).toBe(false));

  it("list default limit=50", () => {
    const r = nutritionOrderListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("complete + cancel requieren uuid", () => {
    expect(nutritionOrderCompleteInput.safeParse({ id: u }).success).toBe(true);
    expect(nutritionOrderCancelInput.safeParse({ id: "abc" }).success).toBe(false);
  });
});
