/**
 * Tests del nutritionRouter — Beta.13 hardening layer 1 + UAT-BUG-02.
 *
 * Cubre:
 *  - State machine: transiciones válidas e inválidas.
 *  - validateDietCompatibility: plan compatible, plan incompatible, plan genérico.
 *  - Exclusividad ENTERAL/PARENTERAL por encounter.
 *  - NutritionAssessment append-only post-firma.
 *  - Comportamientos existentes del skeleton Wave 8.
 *  - UAT-BUG-02: validación PatientAllergy vs DietPlan.allergens en order.create.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { nutritionRouter } from "../nutrition.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const v = "00000000-0000-0000-0000-000000000002";
const w = "00000000-0000-0000-0000-000000000003";

/**
 * Delega el callback de $transaction al mismo mock prisma para que los
 * mocks de create/findMany/domainEvent.create sean visibles dentro del
 * callback transaccional (patrón pathologyRouter.test.ts).
 */
function wireTransaction(prisma: DeepMockProxy<PrismaClient>): void {
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
}

describe("nutritionRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    wireTransaction(prisma);
  });

  // -------------------------------------------------------------------------
  // diet.create / discontinue / list
  // -------------------------------------------------------------------------

  describe("diet.create", () => {
    it("NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.diet.create({ encounterId: u, patientId: u, dietType: "DIABETIC" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si patientId no coincide", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: v } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.diet.create({ encounterId: u, patientId: u, dietType: "REGULAR" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("create OK con compatibleWithDiagnoses", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.dietPlan.create.mockResolvedValue({ id: u } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.diet.create({
        encounterId: u,
        patientId: u,
        dietType: "RENAL",
        compatibleWithDiagnoses: ["N18.3"],
      });
      const data = prisma.dietPlan.create.mock.calls[0]![0]!.data as {
        compatibleWithDiagnoses: string[];
        organizationId: string;
      };
      expect(data.compatibleWithDiagnoses).toEqual(["N18.3"]);
      expect(data.organizationId).toBeTruthy();
    });
  });

  describe("diet.discontinue", () => {
    it("NOT_FOUND si ya cerrado", async () => {
      prisma.dietPlan.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.diet.discontinue({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK setea DISCONTINUED + endedAt", async () => {
      prisma.dietPlan.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.diet.discontinue({ id: u });
      const data = prisma.dietPlan.updateMany.mock.calls[0]![0]!.data as {
        status: string;
        endedAt: Date;
      };
      expect(data.status).toBe("DISCONTINUED");
      expect(data.endedAt).toBeInstanceOf(Date);
    });
  });

  describe("diet.list", () => {
    it("filtra por organizationId", async () => {
      prisma.dietPlan.findMany.mockResolvedValue([] as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.diet.list({ limit: 30 });
      const where = prisma.dietPlan.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
      };
      expect(where.organizationId).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // assessment.create / sign / get / list
  // -------------------------------------------------------------------------

  describe("assessment.create", () => {
    it("OK persiste targetCalories", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.nutritionAssessment.create.mockResolvedValue({ id: u } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.assessment.create({
        encounterId: u,
        patientId: u,
        assessedById: u,
        weightKg: 70,
        heightCm: 170,
        bmi: 24.2,
        malnutritionRisk: "LOW",
        targetCalories: 1800,
      });
      const data = prisma.nutritionAssessment.create.mock.calls[0]![0]!.data as {
        malnutritionRisk: string;
        targetCalories: number;
      };
      expect(data.malnutritionRisk).toBe("LOW");
      expect(data.targetCalories).toBe(1800);
    });
  });

  describe("assessment.sign (append-only)", () => {
    it("NOT_FOUND si no existe", async () => {
      prisma.nutritionAssessment.findFirst.mockResolvedValue(null as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.assessment.sign({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("CONFLICT si ya está firmada", async () => {
      prisma.nutritionAssessment.findFirst.mockResolvedValue({
        id: u,
        signedAt: new Date("2026-01-01"),
      } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.assessment.sign({ id: u })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("OK setea signedAt cuando no está firmada", async () => {
      prisma.nutritionAssessment.findFirst.mockResolvedValue({
        id: u,
        signedAt: null,
      } as never);
      prisma.nutritionAssessment.update.mockResolvedValue({ id: u } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.assessment.sign({ id: u });
      const data = prisma.nutritionAssessment.update.mock.calls[0]![0]!.data as {
        signedAt: Date;
      };
      expect(data.signedAt).toBeInstanceOf(Date);
    });
  });

  describe("assessment.list", () => {
    it("filtra por malnutritionRisk", async () => {
      prisma.nutritionAssessment.findMany.mockResolvedValue([] as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.assessment.list({ malnutritionRisk: "HIGH", limit: 50 });
      const where = prisma.nutritionAssessment.findMany.mock.calls[0]![0]!.where as {
        malnutritionRisk: string;
      };
      expect(where.malnutritionRisk).toBe("HIGH");
    });
  });

  describe("assessment.get", () => {
    it("NOT_FOUND", async () => {
      prisma.nutritionAssessment.findFirst.mockResolvedValue(null as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.assessment.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // -------------------------------------------------------------------------
  // order.create — state machine, exclusivity, diet compatibility
  // -------------------------------------------------------------------------

  describe("order.create — base validations", () => {
    it("NOT_FOUND si encounter no es del tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({ encounterId: u, patientId: u, prescriberId: u, route: "ENTERAL" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si patientId no coincide", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: v } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({ encounterId: u, patientId: u, prescriberId: u, route: "PARENTERAL" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("order.create — ENTERAL/PARENTERAL exclusivity", () => {
    it("CONFLICT si ya existe orden PARENTERAL ACTIVE para el encounter al crear ENTERAL", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      // findFirst for exclusivity returns a conflicting order.
      prisma.nutritionOrder.findFirst.mockResolvedValue({ id: v } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({ encounterId: u, patientId: u, prescriberId: u, route: "ENTERAL" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("CONFLICT si ya existe orden ENTERAL ORDERED al crear PARENTERAL", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.nutritionOrder.findFirst.mockResolvedValue({ id: v } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({ encounterId: u, patientId: u, prescriberId: u, route: "PARENTERAL" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("OK si no hay conflicto de exclusividad (findFirst retorna null)", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.nutritionOrder.findFirst.mockResolvedValue(null as never);
      // patientAllergy.findMany needed for allergy check (no dietPlanId → skipped entirely)
      prisma.nutritionOrder.create.mockResolvedValue({ id: w } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "ENTERAL",
        formula: "Ensure Plus",
        ratePerHour: 60,
      });
      // Status inicial debe ser ORDERED.
      const data = prisma.nutritionOrder.create.mock.calls[0]![0]!.data as {
        status: string;
        route: string;
      };
      expect(data.status).toBe("ORDERED");
      expect(data.route).toBe("ENTERAL");
      expect(result).toMatchObject({ id: w });
    });
  });

  describe("order.create — diet plan compatibility", () => {
    it("NOT_FOUND si dietPlanId no existe en la organización", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.nutritionOrder.findFirst.mockResolvedValue(null as never); // no exclusivity conflict
      prisma.dietPlan.findFirst.mockResolvedValue(null as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          prescriberId: u,
          route: "ENTERAL",
          dietPlanId: v,
          encounterDiagnoses: ["E11"],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si plan no es compatible con los diagnósticos del encounter", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.nutritionOrder.findFirst.mockResolvedValue(null as never);
      // Plan solo compatible con N18.3, encounter tiene E11.
      prisma.dietPlan.findFirst.mockResolvedValue({
        compatibleWithDiagnoses: ["N18.3"],
      } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          prescriberId: u,
          route: "ENTERAL",
          dietPlanId: v,
          encounterDiagnoses: ["E11"],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("OK si hay intersección de diagnósticos", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.nutritionOrder.findFirst.mockResolvedValue(null as never);
      // validateDietCompatibility query (returns compatibleWithDiagnoses)
      // findAllergyConflicts query (returns allergens)
      // Both use dietPlan.findFirst — mock returns both fields.
      prisma.dietPlan.findFirst.mockResolvedValue({
        compatibleWithDiagnoses: ["E11", "N18.3"],
        allergens: [],
      } as never);
      prisma.patientAllergy.findMany.mockResolvedValue([] as never);
      prisma.nutritionOrder.create.mockResolvedValue({ id: w } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "ENTERAL",
        dietPlanId: v,
        encounterDiagnoses: ["E11"],
      });
      const data = prisma.nutritionOrder.create.mock.calls[0]![0]!.data as {
        dietPlanId: string;
      };
      expect(data.dietPlanId).toBe(v);
    });

    it("OK si plan es genérico (compatibleWithDiagnoses vacío)", async () => {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.nutritionOrder.findFirst.mockResolvedValue(null as never);
      prisma.dietPlan.findFirst.mockResolvedValue({
        compatibleWithDiagnoses: [],
        allergens: [],
      } as never);
      prisma.patientAllergy.findMany.mockResolvedValue([] as never);
      prisma.nutritionOrder.create.mockResolvedValue({ id: w } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "PARENTERAL",
        dietPlanId: v,
        encounterDiagnoses: ["X99"],
      });
      expect(prisma.nutritionOrder.create).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // UAT-BUG-02 — order.create: validación PatientAllergy vs DietPlan.allergens
  // -------------------------------------------------------------------------

  describe("order.create — UAT-BUG-02 allergy conflict validation", () => {
    /**
     * Helper: mock de encounter + exclusivity (sin conflicto) + dietPlan.findFirst
     * con alergenos especificados.
     */
    function mockBaseForAllergyTests(allergens: string[]): void {
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      prisma.nutritionOrder.findFirst.mockResolvedValue(null as never);
      // validateDietCompatibility usa findFirst({ select: { compatibleWithDiagnoses } })
      // findAllergyConflicts usa findFirst({ select: { allergens } })
      // Las dos son llamadas separadas al mismo mock — ambas necesitan retornar ambos campos.
      prisma.dietPlan.findFirst.mockResolvedValue({
        compatibleWithDiagnoses: [],
        allergens,
      } as never);
    }

    it("Happy: paciente sin alergia conflictiva → create OK", async () => {
      mockBaseForAllergyTests(["NUTS", "DAIRY"]);
      // Paciente alérgico a SHELLFISH — no hay intersección.
      prisma.patientAllergy.findMany.mockResolvedValue([
        { substanceText: "SHELLFISH" },
      ] as never);
      prisma.nutritionOrder.create.mockResolvedValue({ id: w } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "ENTERAL",
        dietPlanId: v,
      });
      expect(result).toMatchObject({ id: w });
      expect(prisma.nutritionOrder.create).toHaveBeenCalledOnce();
    });

    it("PRECONDITION_FAILED: paciente alérgico a NUTS, plan contiene NUTS", async () => {
      mockBaseForAllergyTests(["NUTS", "DAIRY"]);
      prisma.patientAllergy.findMany.mockResolvedValue([
        { substanceText: "NUTS" },
      ] as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          prescriberId: u,
          route: "ENTERAL",
          dietPlanId: v,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("Override válido → create OK + emite evento nutrition.allergyOverride", async () => {
      mockBaseForAllergyTests(["NUTS"]);
      prisma.patientAllergy.findMany.mockResolvedValue([
        { substanceText: "NUTS" },
      ] as never);
      prisma.nutritionOrder.create.mockResolvedValue({ id: w } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: u } as never);
      prisma.auditLog.create.mockResolvedValue({} as never);

      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "ENTERAL",
        dietPlanId: v,
        overrideAllergy: {
          reason: "Paciente firmó consentimiento informado previo a la intervención.",
          acknowledgedBy: "Dr. García",
        },
      });

      expect(result).toMatchObject({ id: w });
      // Verifica que emitDomainEvent (implementado como domainEvent.create) fue llamado
      // con eventType nutrition.allergyOverride.
      const eventCall = prisma.domainEvent.create.mock.calls.find(
        (c) => c[0]?.data?.eventType === "nutrition.allergyOverride",
      );
      expect(eventCall).toBeDefined();
      const payload = eventCall![0]!.data!.payload as {
        conflictingAllergens: string[];
        reason: string;
      };
      expect(payload.conflictingAllergens).toContain("NUTS");
      expect(payload.reason).toContain("consentimiento");
    });

    it("Override sin reason → ZodError (validación de input)", async () => {
      // No necesitamos mocks de BD — Zod rechaza antes de llegar al handler.
      prisma.encounter.findFirst.mockResolvedValue({ id: u, patientId: u } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.order.create({
          encounterId: u,
          patientId: u,
          prescriberId: u,
          route: "ENTERAL",
          dietPlanId: v,
          // @ts-expect-error — forzamos reason vacío para test de validación
          overrideAllergy: { reason: "", acknowledgedBy: "Dr. García" },
        }),
      ).rejects.toThrow();
    });

    it("PatientAllergy inactive → ignorada (no bloquea create)", async () => {
      mockBaseForAllergyTests(["GLUTEN"]);
      // La alergia a GLUTEN existe pero active = false — findAllergyConflicts filtra active:true.
      // El mock retorna vacío porque whereactive=true excluiría la inactiva.
      prisma.patientAllergy.findMany.mockResolvedValue([] as never);
      prisma.nutritionOrder.create.mockResolvedValue({ id: w } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.order.create({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        route: "ENTERAL",
        dietPlanId: v,
      });
      expect(result).toMatchObject({ id: w });
    });
  });

  // -------------------------------------------------------------------------
  // order state machine transitions
  // -------------------------------------------------------------------------

  describe("order.activate (ORDERED|HELD → ACTIVE)", () => {
    it("NOT_FOUND si no existe", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue(null as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.activate({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("BAD_REQUEST si intenta activar desde COMPLETED (terminal)", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue({
        id: u,
        status: "COMPLETED",
      } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.activate({ id: u })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("OK desde ORDERED", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue({
        id: u,
        status: "ORDERED",
      } as never);
      prisma.nutritionOrder.update.mockResolvedValue({ id: u, status: "ACTIVE" } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.order.activate({ id: u });
      const data = prisma.nutritionOrder.update.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(data.status).toBe("ACTIVE");
    });

    it("OK desde HELD", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue({
        id: u,
        status: "HELD",
      } as never);
      prisma.nutritionOrder.update.mockResolvedValue({ id: u, status: "ACTIVE" } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.order.activate({ id: u });
      expect(prisma.nutritionOrder.update).toHaveBeenCalled();
    });
  });

  describe("order.hold (ACTIVE|ORDERED → HELD)", () => {
    it("OK desde ACTIVE", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
      } as never);
      prisma.nutritionOrder.update.mockResolvedValue({ id: u, status: "HELD" } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.order.hold({ id: u });
      const data = prisma.nutritionOrder.update.mock.calls[0]![0]!.data as {
        status: string;
      };
      expect(data.status).toBe("HELD");
    });

    it("BAD_REQUEST si intenta suspender desde COMPLETED", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue({
        id: u,
        status: "COMPLETED",
      } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.hold({ id: u })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });
  });

  describe("order.complete (ACTIVE|HELD → COMPLETED)", () => {
    it("NOT_FOUND si no existe", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue(null as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.complete({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("BAD_REQUEST desde CANCELLED (terminal)", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue({
        id: u,
        status: "CANCELLED",
      } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.complete({ id: u })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("BAD_REQUEST: HELD no puede ir directamente a COMPLETED", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue({
        id: u,
        status: "HELD",
      } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.complete({ id: u })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("OK desde ACTIVE — setea COMPLETED + endedAt", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue({
        id: u,
        status: "ACTIVE",
      } as never);
      prisma.nutritionOrder.update.mockResolvedValue({ id: u } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.order.complete({ id: u });
      expect(r.ok).toBe(true);
      const data = prisma.nutritionOrder.update.mock.calls[0]![0]!.data as {
        status: string;
        endedAt: Date;
      };
      expect(data.status).toBe("COMPLETED");
      expect(data.endedAt).toBeInstanceOf(Date);
    });
  });

  describe("order.cancel (ORDERED|ACTIVE|HELD → CANCELLED)", () => {
    it("OK desde ORDERED", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue({
        id: u,
        status: "ORDERED",
      } as never);
      prisma.nutritionOrder.update.mockResolvedValue({ id: u } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.order.cancel({ id: u });
      const data = prisma.nutritionOrder.update.mock.calls[0]![0]!.data as {
        status: string;
        endedAt: Date;
      };
      expect(data.status).toBe("CANCELLED");
      expect(data.endedAt).toBeInstanceOf(Date);
    });

    it("BAD_REQUEST desde COMPLETED (terminal)", async () => {
      prisma.nutritionOrder.findFirst.mockResolvedValue({
        id: u,
        status: "COMPLETED",
      } as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.order.cancel({ id: u })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });
  });

  describe("order.list", () => {
    it("filtra por route y status", async () => {
      prisma.nutritionOrder.findMany.mockResolvedValue([] as never);
      const caller = nutritionRouter.createCaller(makeCtx({ prisma }));
      await caller.order.list({ route: "PARENTERAL", status: "ORDERED", limit: 50 });
      const where = prisma.nutritionOrder.findMany.mock.calls[0]![0]!.where as {
        route: string;
        status: string;
      };
      expect(where.route).toBe("PARENTERAL");
      expect(where.status).toBe("ORDERED");
    });
  });
});
