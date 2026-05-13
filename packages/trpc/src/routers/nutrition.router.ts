/**
 * §22 Nutrition — router (Beta.13 hardening layer 1).
 *
 * Nuevas capacidades sobre el skeleton Wave 8:
 *  - State machine: ORDERED→ACTIVE→COMPLETED | HELD | CANCELLED. Transitions validadas.
 *  - validateDietCompatibility: dietPlanId vs encounterDiagnoses.
 *  - Exclusividad ENTERAL/PARENTERAL por encounter activo (ORDERED|ACTIVE).
 *  - NutritionAssessment append-only post-firma (sign mutation).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
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
  type NutritionOrderStatus,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function ensureEncounterAndPatient(
  prisma: {
    encounter: {
      findFirst: (q: object) => Promise<{ id: string; patientId: string } | null>;
    };
  },
  encounterId: string,
  patientId: string,
  organizationId: string,
): Promise<void> {
  const enc = await prisma.encounter.findFirst({
    where: { id: encounterId, organizationId },
    select: { id: true, patientId: true },
  });
  if (!enc) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Encuentro no existe en la organización.",
    });
  }
  if (enc.patientId !== patientId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "patientId no coincide con encounter.",
    });
  }
}

/**
 * Verifica que la transición de estado sea válida según la state machine.
 * Lanza BAD_REQUEST si la transición no está permitida.
 */
function assertValidTransition(
  currentStatus: NutritionOrderStatus,
  nextStatus: NutritionOrderStatus,
  orderId: string,
): void {
  const allowed = NUTRITION_ORDER_TRANSITIONS[currentStatus];
  if (!allowed.includes(nextStatus)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Transición inválida: ${currentStatus} → ${nextStatus} para orden ${orderId}.`,
    });
  }
}

/**
 * Valida que el DietPlan tenga al menos un diagnóstico compatible con
 * los diagnósticos activos del encounter.
 *
 * Si el dietPlan no tiene diagnósticos configurados (lista vacía), se asume
 * compatible con cualquier diagnóstico (plan genérico).
 */
async function validateDietCompatibility(
  prisma: {
    dietPlan: {
      findFirst: (q: object) => Promise<{ compatibleWithDiagnoses: string[] } | null>;
    };
  },
  dietPlanId: string,
  organizationId: string,
  encounterDiagnoses: string[],
): Promise<void> {
  const plan = await prisma.dietPlan.findFirst({
    where: { id: dietPlanId, organizationId },
    select: { compatibleWithDiagnoses: true },
  });
  if (!plan) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Plan dietético no encontrado en la organización.",
    });
  }
  const compatible = plan.compatibleWithDiagnoses;
  // Empty compatible list = generic plan, always valid.
  if (compatible.length === 0) return;
  const hasMatch = encounterDiagnoses.some((dx) => compatible.includes(dx));
  if (!hasMatch) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Plan dietético no es compatible con los diagnósticos activos del encounter.",
    });
  }
}

/**
 * Valida exclusividad enteral/parenteral: un encounter activo no puede tener
 * simultáneamente una orden ENTERAL y una PARENTERAL en estado ORDERED o ACTIVE.
 */
async function assertEnteralParenteralExclusivity(
  prisma: {
    nutritionOrder: {
      findFirst: (q: object) => Promise<{ id: string } | null>;
    };
  },
  encounterId: string,
  organizationId: string,
  newRoute: "ENTERAL" | "PARENTERAL",
): Promise<void> {
  const oppositeRoute = newRoute === "ENTERAL" ? "PARENTERAL" : "ENTERAL";
  const conflict = await prisma.nutritionOrder.findFirst({
    where: {
      encounterId,
      organizationId,
      route: oppositeRoute,
      status: { in: ["ORDERED", "ACTIVE"] },
    },
    select: { id: true },
  });
  if (conflict) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `El encounter ya tiene una orden ${oppositeRoute} activa (${conflict.id}). Las rutas ENTERAL y PARENTERAL son mutuamente excluyentes por encounter.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const nutritionRouter = router({
  diet: router({
    list: tenantProcedure
      .input(dietPlanListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.dietPlan.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.encounterId && { encounterId: input.encounterId }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.status && { status: input.status }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
          },
          orderBy: { startedAt: "desc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(dietPlanCreateInput)
      .mutation(async ({ ctx, input }) => {
        await ensureEncounterAndPatient(
          ctx.prisma,
          input.encounterId,
          input.patientId,
          ctx.tenant.organizationId,
        );
        return ctx.prisma.dietPlan.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            dietType: input.dietType,
            caloriesTarget: input.caloriesTarget ?? null,
            proteinTarget: input.proteinTarget ?? null,
            compatibleWithDiagnoses: input.compatibleWithDiagnoses,
            notes: input.notes ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    discontinue: tenantProcedure
      .input(dietPlanDiscontinueInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.dietPlan.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: "ACTIVE",
          },
          data: {
            status: "DISCONTINUED",
            endedAt: new Date(),
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Plan no existe o no está ACTIVO.",
          });
        }
        return { ok: true as const };
      }),
  }),

  assessment: router({
    list: tenantProcedure
      .input(nutritionAssessmentListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.nutritionAssessment.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.encounterId && { encounterId: input.encounterId }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.malnutritionRisk && {
              malnutritionRisk: input.malnutritionRisk,
            }),
          },
          orderBy: { assessedAt: "desc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(nutritionAssessmentCreateInput)
      .mutation(async ({ ctx, input }) => {
        await ensureEncounterAndPatient(
          ctx.prisma,
          input.encounterId,
          input.patientId,
          ctx.tenant.organizationId,
        );
        return ctx.prisma.nutritionAssessment.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            assessedById: input.assessedById,
            weightKg: input.weightKg ?? null,
            heightCm: input.heightCm ?? null,
            bmi: input.bmi ?? null,
            malnutritionRisk: input.malnutritionRisk ?? null,
            targetCalories: input.targetCalories ?? null,
            notes: input.notes ?? null,
          },
        });
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await ctx.prisma.nutritionAssessment.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
        });
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    /**
     * Firma una valoración nutricional. Una vez firmada (signedAt NOT NULL),
     * el registro es inmutable: el trigger de BD rechaza cualquier UPDATE/DELETE.
     */
    sign: tenantProcedure
      .input(nutritionAssessmentSignInput)
      .mutation(async ({ ctx, input }) => {
        const assessment = await ctx.prisma.nutritionAssessment.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          select: { id: true, signedAt: true },
        });
        if (!assessment) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (assessment.signedAt !== null) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Valoración ya firmada. No se puede modificar.",
          });
        }
        return ctx.prisma.nutritionAssessment.update({
          where: { id: input.id },
          data: { signedAt: new Date() },
        });
      }),
  }),

  order: router({
    list: tenantProcedure
      .input(nutritionOrderListInput)
      .query(async ({ ctx, input }) => {
        return ctx.prisma.nutritionOrder.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input.encounterId && { encounterId: input.encounterId }),
            ...(input.patientId && { patientId: input.patientId }),
            ...(input.route && { route: input.route }),
            ...(input.status && { status: input.status }),
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            prescriber: { select: { id: true, fullName: true } },
          },
          orderBy: { startedAt: "desc" },
          take: input.limit,
        });
      }),

    create: tenantProcedure
      .input(nutritionOrderCreateInput)
      .mutation(async ({ ctx, input }) => {
        await ensureEncounterAndPatient(
          ctx.prisma,
          input.encounterId,
          input.patientId,
          ctx.tenant.organizationId,
        );

        // Exclusivity check: ENTERAL ↔ PARENTERAL cannot coexist in ORDERED|ACTIVE.
        await assertEnteralParenteralExclusivity(
          ctx.prisma,
          input.encounterId,
          ctx.tenant.organizationId,
          input.route,
        );

        // Diet plan compatibility check.
        if (input.dietPlanId) {
          await validateDietCompatibility(
            ctx.prisma,
            input.dietPlanId,
            ctx.tenant.organizationId,
            input.encounterDiagnoses,
          );
        }

        return ctx.prisma.nutritionOrder.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            prescriberId: input.prescriberId,
            route: input.route,
            status: "ORDERED",
            formula: input.formula ?? null,
            ratePerHour: input.ratePerHour ?? null,
            totalVolume: input.totalVolume ?? null,
            caloriesPerDay: input.caloriesPerDay ?? null,
            dietPlanId: input.dietPlanId ?? null,
            notes: input.notes ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    /** ORDERED | HELD → ACTIVE */
    activate: tenantProcedure
      .input(nutritionOrderActivateInput)
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.nutritionOrder.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          select: { id: true, status: true },
        });
        if (!order) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        assertValidTransition(order.status as NutritionOrderStatus, "ACTIVE", order.id);
        return ctx.prisma.nutritionOrder.update({
          where: { id: input.id },
          data: { status: "ACTIVE" },
        });
      }),

    /** ACTIVE → HELD */
    hold: tenantProcedure
      .input(nutritionOrderHoldInput)
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.nutritionOrder.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          select: { id: true, status: true },
        });
        if (!order) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        assertValidTransition(order.status as NutritionOrderStatus, "HELD", order.id);
        return ctx.prisma.nutritionOrder.update({
          where: { id: input.id },
          data: { status: "HELD" },
        });
      }),

    /** ACTIVE | HELD → COMPLETED */
    complete: tenantProcedure
      .input(nutritionOrderCompleteInput)
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.nutritionOrder.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          select: { id: true, status: true },
        });
        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden no existe.",
          });
        }
        assertValidTransition(order.status as NutritionOrderStatus, "COMPLETED", order.id);
        await ctx.prisma.nutritionOrder.update({
          where: { id: input.id },
          data: { status: "COMPLETED", endedAt: new Date() },
        });
        return { ok: true as const };
      }),

    /** ORDERED | ACTIVE | HELD → CANCELLED */
    cancel: tenantProcedure
      .input(nutritionOrderCancelInput)
      .mutation(async ({ ctx, input }) => {
        const order = await ctx.prisma.nutritionOrder.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
          select: { id: true, status: true },
        });
        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden no existe.",
          });
        }
        assertValidTransition(order.status as NutritionOrderStatus, "CANCELLED", order.id);
        await ctx.prisma.nutritionOrder.update({
          where: { id: input.id },
          data: { status: "CANCELLED", endedAt: new Date() },
        });
        return { ok: true as const };
      }),
  }),
});
