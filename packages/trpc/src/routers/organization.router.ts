import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  setFunctionalCurrencyInputSchema,
  setFunctionalCurrencyResultSchema,
} from "@his/contracts";
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

  /**
   * US-1.6 — listado para la UI de admin: incluye país, moneda funcional/presentación
   * y los códigos de rol del usuario actual sobre cada org (para gating en cliente).
   * Sólo devuelve organizaciones donde el usuario tiene al menos un rol vigente
   * (evita exponer organizaciones de otros tenants — multi-tenant boundary).
   */
  listAll: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const memberships = await ctx.prisma.userOrganizationRole.findMany({
      where: {
        userId: ctx.user.id,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      include: { role: true },
    });
    if (memberships.length === 0) return [];
    const orgIds = Array.from(new Set(memberships.map((m) => m.organizationId)));
    const rolesByOrg = new Map<string, string[]>();
    for (const m of memberships) {
      const arr = rolesByOrg.get(m.organizationId) ?? [];
      arr.push(m.role.code);
      rolesByOrg.set(m.organizationId, arr);
    }
    const orgs = await ctx.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      include: {
        country: { select: { id: true, isoAlpha3: true, name: true } },
        functionalCurr: { select: { id: true, isoCode: true, name: true, symbol: true } },
        reportingCurr: { select: { id: true, isoCode: true, name: true, symbol: true } },
      },
      orderBy: [{ active: "desc" }, { legalName: "asc" }],
    });
    return orgs.map((o) => ({
      ...o,
      roles: rolesByOrg.get(o.id) ?? [],
      isAdmin: (rolesByOrg.get(o.id) ?? []).includes("ADMIN"),
    }));
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

  /**
   * US-1.6 — actualiza la moneda funcional de una organización.
   * Reglas:
   *   1) Currency debe existir y estar activa.
   *   2) El usuario debe ser ADMIN vigente en esa org.
   *   3) Si la org tiene encuentros existentes y `confirmDestructive` no fue enviado,
   *      devolvemos `requiresConfirmation: true` SIN persistir (el cliente debe
   *      re-llamar con confirmDestructive=true tras mostrar el warning destructivo).
   *      No bloqueamos definitivamente; Sprint 2 implementará revaluación contable.
   */
  setFunctionalCurrency: protectedProcedure
    .input(setFunctionalCurrencyInputSchema)
    .output(setFunctionalCurrencyResultSchema)
    .mutation(async ({ ctx, input }) => {
      // 1) Currency activa.
      const currency = await ctx.prisma.currency.findUnique({
        where: { id: input.currencyId },
      });
      if (!currency || !currency.active) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Moneda no existe o está inactiva.",
        });
      }

      // 2) Membresía ADMIN vigente.
      const now = new Date();
      const adminMembership = await ctx.prisma.userOrganizationRole.findFirst({
        where: {
          userId: ctx.user.id,
          organizationId: input.organizationId,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
          role: { code: "ADMIN" },
        },
      });
      if (!adminMembership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Requiere rol ADMIN en la organización.",
        });
      }

      // 3) Conteo de encuentros (proxy de "transacciones" en Sprint 1: aún no hay
      // Charges/Invoices). Si hay y el cliente no confirmó, pedimos confirmación.
      const encounterCount = await ctx.prisma.encounter.count({
        where: { organizationId: input.organizationId },
      });

      // No-op si la moneda no cambia.
      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: { functionalCurrency: true },
      });
      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organización no encontrada." });
      }
      const isSame = org.functionalCurrency === input.currencyId;

      if (!isSame && encounterCount > 0 && !input.confirmDestructive) {
        return {
          ok: false,
          organizationId: input.organizationId,
          functionalCurrency: org.functionalCurrency,
          encounterCount,
          requiresConfirmation: true,
          warning:
            "Esta organización tiene encuentros registrados. Cambiar la moneda funcional puede afectar reportes financieros. Confirma para continuar (Sprint 2 implementará revaluación contable).",
        };
      }

      const updated = await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { functionalCurrency: input.currencyId, updatedBy: ctx.user.id },
        select: { id: true, functionalCurrency: true },
      });

      return {
        ok: true,
        organizationId: updated.id,
        functionalCurrency: updated.functionalCurrency,
        encounterCount,
        requiresConfirmation: false,
        warning:
          encounterCount > 0
            ? "Moneda funcional actualizada. Revisar reportes financieros (revaluación pendiente Sprint 2)."
            : null,
      };
    }),
});
