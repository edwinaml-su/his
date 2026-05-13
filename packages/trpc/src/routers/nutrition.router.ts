/**
 * §22 Nutrition — router skeleton (Wave 8 / Phase 2 entry).
 *
 * Cobertura mínima:
 *   - DietPlan create/list/discontinue.
 *   - NutritionAssessment create/list.
 *   - NutritionOrder (enteral/parenteral) workflow create → complete | cancel.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  dietPlanCreateInput,
  dietPlanListInput,
  dietPlanDiscontinueInput,
  nutritionAssessmentCreateInput,
  nutritionAssessmentListInput,
  nutritionOrderCreateInput,
  nutritionOrderListInput,
  nutritionOrderCompleteInput,
  nutritionOrderCancelInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

/**
 * Helper interno: valida que un encounter pertenezca al tenant y que el
 * patientId del input coincida con el encounter.patientId. Devuelve { id }
 * o lanza TRPCError.
 */
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
        return ctx.prisma.nutritionOrder.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            encounterId: input.encounterId,
            patientId: input.patientId,
            prescriberId: input.prescriberId,
            route: input.route,
            formula: input.formula ?? null,
            ratePerHour: input.ratePerHour ?? null,
            totalVolume: input.totalVolume ?? null,
            caloriesPerDay: input.caloriesPerDay ?? null,
            notes: input.notes ?? null,
            createdBy: ctx.user.id,
          },
        });
      }),

    complete: tenantProcedure
      .input(nutritionOrderCompleteInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.nutritionOrder.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["ACTIVE", "ON_HOLD"] },
          },
          data: {
            status: "COMPLETED",
            endedAt: new Date(),
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden no existe o ya está cerrada.",
          });
        }
        return { ok: true as const };
      }),

    cancel: tenantProcedure
      .input(nutritionOrderCancelInput)
      .mutation(async ({ ctx, input }) => {
        const updated = await ctx.prisma.nutritionOrder.updateMany({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            status: { in: ["ACTIVE", "ON_HOLD"] },
          },
          data: {
            status: "CANCELLED",
            endedAt: new Date(),
          },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Orden no existe o ya está cerrada.",
          });
        }
        return { ok: true as const };
      }),
  }),
});
