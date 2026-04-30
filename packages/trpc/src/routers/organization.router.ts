import { z } from "zod";
import { router, protectedProcedure, tenantProcedure } from "../trpc";

export const organizationRouter = router({
  /** Lista las organizaciones donde el usuario tiene al menos un rol vigente. */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const memberships = await ctx.prisma.userOrganizationRole.findMany({
      where: {
        userId: ctx.user.id,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      include: {
        organization: {
          include: { establishments: { where: { active: true } } },
        },
        role: true,
      },
    });
    // Deduplicar por org.
    const map = new Map<string, (typeof memberships)[number]["organization"] & { roles: string[] }>();
    for (const m of memberships) {
      const existing = map.get(m.organizationId);
      if (existing) {
        existing.roles.push(m.role.code);
      } else {
        map.set(m.organizationId, { ...m.organization, roles: [m.role.code] });
      }
    }
    return Array.from(map.values());
  }),

  /** Devuelve la organización activa según el tenant context. */
  current: tenantProcedure.query(async ({ ctx }) => {
    return ctx.prisma.organization.findUnique({
      where: { id: ctx.tenant.organizationId },
      include: { establishments: { where: { active: true } } },
    });
  }),

  /**
   * Cambia la organización activa para la sesión.
   * NOTA: el switch real (cookie/sesión Supabase) lo hace el cliente
   * que consume este resultado. Aquí sólo validamos pertenencia.
   */
  switch: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const membership = await ctx.prisma.userOrganizationRole.findFirst({
        where: {
          userId: ctx.user.id,
          organizationId: input.organizationId,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
      });
      if (!membership) {
        throw new Error("No perteneces a esa organización.");
      }
      return { ok: true, organizationId: input.organizationId };
    }),
});
