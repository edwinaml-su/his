import { z } from "zod";
import { triageEvaluationCreateSchema } from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const triageRouter = router({
  /** Lista los niveles Manchester configurados en la organización activa. */
  listLevels: tenantProcedure.query(async ({ ctx }) => {
    return ctx.prisma.triageLevel.findMany({
      where: { organizationId: ctx.tenant.organizationId, active: true },
      orderBy: { priority: "asc" },
    });
  }),

  listFlowcharts: tenantProcedure
    .input(z.object({ pediatric: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.prisma.triageFlowchart.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          active: true,
          ...(input?.pediatric !== undefined ? { isPediatric: input.pediatric } : {}),
        },
        orderBy: { name: "asc" },
      });
    }),

  getDiscriminators: tenantProcedure
    .input(z.object({ flowchartId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.triageDiscriminator.findMany({
        where: { flowchartId: input.flowchartId, active: true },
        orderBy: { ordinal: "asc" },
        include: { resultLevel: true },
      });
    }),

  /** Cola de triage: encuentros sin alta y sin evaluación COMPLETED hoy. */
  listPending: tenantProcedure.query(async ({ ctx }) => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    return ctx.prisma.encounter.findMany({
      where: {
        organizationId: ctx.tenant.organizationId,
        dischargedAt: null,
        admittedAt: { gte: since },
        triages: { none: { status: "COMPLETED" } },
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        triages: {
          orderBy: { startedAt: "desc" },
          take: 1,
          include: { assignedLevel: true },
        },
      },
      orderBy: { admittedAt: "asc" },
    });
  }),

  createEvaluation: tenantProcedure
    .input(triageEvaluationCreateSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenant.establishmentId) {
        throw new Error("Selecciona un establecimiento antes de evaluar.");
      }
      const { vitalSigns, discriminatorHits, ...rest } = input;
      return ctx.prisma.triageEvaluation.create({
        data: {
          ...rest,
          countryId: ctx.tenant.countryId,
          organizationId: ctx.tenant.organizationId,
          establishmentId: ctx.tenant.establishmentId,
          triagistUserId: ctx.user.id,
          status: "COMPLETED",
          completedAt: new Date(),
          createdBy: ctx.user.id,
          vitalSigns: { create: vitalSigns },
          discriminatorHits: { create: discriminatorHits },
        },
        include: { assignedLevel: true, vitalSigns: true, discriminatorHits: true },
      });
    }),
});
