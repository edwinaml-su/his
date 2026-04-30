import { bedListSchema, bedUpdateStatusSchema } from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const bedRouter = router({
  list: tenantProcedure.input(bedListSchema).query(async ({ ctx, input }) => {
    return ctx.prisma.bed.findMany({
      where: {
        organizationId: ctx.tenant.organizationId,
        active: true,
        ...(input.serviceUnitId ? { serviceUnitId: input.serviceUnitId } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      include: {
        serviceUnit: true,
        assignments: {
          where: { releasedAt: null },
          include: { encounter: { include: { patient: true } } },
          take: 1,
        },
      },
      orderBy: [{ serviceUnitId: "asc" }, { code: "asc" }],
    });
  }),

  /** Igual que list pero agrupado por servicio para el componente BedMap. */
  getMap: tenantProcedure.query(async ({ ctx }) => {
    const services = await ctx.prisma.serviceUnit.findMany({
      where: { organizationId: ctx.tenant.organizationId, active: true },
      include: {
        beds: {
          where: { active: true },
          include: {
            assignments: {
              where: { releasedAt: null },
              include: { encounter: { include: { patient: true } } },
              take: 1,
            },
          },
          orderBy: { code: "asc" },
        },
      },
      orderBy: { code: "asc" },
    });
    return services.filter((s) => s.beds.length > 0);
  }),

  updateStatus: tenantProcedure
    .input(bedUpdateStatusSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.bed.update({
        where: { id: input.bedId },
        data: { status: input.status },
      });
    }),
});
