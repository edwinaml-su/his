import { z } from "zod";
import { router, tenantProcedure } from "../trpc";

export const auditRouter = router({
  listByEntity: tenantProcedure
    .input(
      z.object({
        entity: z.string().min(1).max(80),
        entityId: z.string().min(1).max(80),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        entity: input.entity,
        entityId: input.entityId,
        organizationId: ctx.tenant.organizationId,
      };
      const [items, total] = await Promise.all([
        ctx.prisma.auditLog.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: { occurredAt: "desc" },
        }),
        ctx.prisma.auditLog.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }),

  listByUser: tenantProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        userId: input.userId,
        organizationId: ctx.tenant.organizationId,
        ...(input.from || input.to
          ? {
              occurredAt: {
                ...(input.from ? { gte: input.from } : {}),
                ...(input.to ? { lte: input.to } : {}),
              },
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.auditLog.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: { occurredAt: "desc" },
        }),
        ctx.prisma.auditLog.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }),
});
