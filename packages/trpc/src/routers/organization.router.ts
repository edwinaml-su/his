import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  setFunctionalCurrencyInputSchema,
  setFunctionalCurrencyResultSchema,
} from "@his/contracts";
import { router, protectedProcedure, tenantProcedure } from "../trpc";

/**
 * US-1.2 — nodo del árbol jerárquico Holding -> Empresa -> Establecimiento.
 *
 * Convención del MVP (read-only, sin drag-drop):
 *   - `type` se infiere: si parentId IS NULL -> HOLDING, si tiene padre -> COMPANY.
 *     Establecimientos viajan en `establishments` (hojas físicas) — el schema
 *     no tiene un tipo enum a nivel Organization, así que la clasificación
 *     ocurre en el server según topología.
 *   - `children` contiene sólo organizaciones hijas; los establecimientos
 *     se exponen aparte para que la UI pueda renderizarlos con icono distinto
 *     (Hospital) y sin mezclar entidades.
 *   - `membersCount` cuenta UserOrganizationRole vigentes (validTo null o futuro).
 */
export type OrgTreeNode = {
  id: string;
  legalName: string;
  tradeName: string;
  type: "HOLDING" | "COMPANY" | "ESTABLISHMENT";
  active: boolean;
  parentId: string | null;
  children: OrgTreeNode[];
  establishments: Array<{
    id: string;
    code: string;
    name: string;
    type: "ESTABLISHMENT";
    active: boolean;
  }>;
  membersCount: number;
};

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

  /**
   * US-1.2 — devuelve el árbol jerárquico desde el holding raíz, limitado a
   * las organizaciones donde el usuario tiene al menos un rol vigente.
   *
   * Implementación:
   *   1) Resolvemos las orgs accesibles para el usuario.
   *   2) Cargamos esas orgs + ancestros transitivos hasta llegar a la raíz
   *      (parentId == null) para que la UI siempre muestre la cadena completa.
   *   3) Cargamos establecimientos activos y conteo de miembros vigentes en
   *      una sola pasada para evitar N+1.
   *   4) Construimos el bosque (puede haber >1 holding si el usuario pertenece
   *      a varios tenants distintos) y recursivamente armamos children.
   *
   * El cliente trata el resultado como un array; típicamente tendrá un único
   * holding root. No se modifica schema; la jerarquía se infiere de parentId.
   */
  listTree: protectedProcedure.query(async ({ ctx }): Promise<OrgTreeNode[]> => {
    const now = new Date();
    const memberships = await ctx.prisma.userOrganizationRole.findMany({
      where: {
        userId: ctx.user.id,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      select: { organizationId: true },
    });
    const seedIds = Array.from(new Set(memberships.map((m) => m.organizationId)));
    if (seedIds.length === 0) return [];

    // Subir hasta la raíz: traemos en lotes hasta que no haya parentIds nuevos.
    const idsToFetch = new Set<string>(seedIds);
    const allOrgs = new Map<
      string,
      {
        id: string;
        parentId: string | null;
        legalName: string;
        tradeName: string | null;
        active: boolean;
      }
    >();

    let frontier = Array.from(idsToFetch);
    // Cota dura para evitar bucles si la BD tuviera un ciclo (no debería, FK).
    let safety = 10;
    while (frontier.length > 0 && safety-- > 0) {
      const batch = await ctx.prisma.organization.findMany({
        where: { id: { in: frontier } },
        select: {
          id: true,
          parentId: true,
          legalName: true,
          tradeName: true,
          active: true,
        },
      });
      const next: string[] = [];
      for (const o of batch) {
        if (allOrgs.has(o.id)) continue;
        allOrgs.set(o.id, o);
        if (o.parentId && !allOrgs.has(o.parentId)) next.push(o.parentId);
      }
      frontier = next;
    }

    const orgIds = Array.from(allOrgs.keys());

    // Establecimientos activos por org + conteo de miembros (1 query c/u en bulk).
    const [establishments, memberCounts] = await Promise.all([
      ctx.prisma.establishment.findMany({
        where: { organizationId: { in: orgIds }, active: true },
        select: {
          id: true,
          organizationId: true,
          code: true,
          name: true,
          active: true,
        },
        orderBy: { code: "asc" },
      }),
      ctx.prisma.userOrganizationRole.groupBy({
        by: ["organizationId"],
        where: {
          organizationId: { in: orgIds },
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
        _count: { _all: true },
      }),
    ]);

    const estByOrg = new Map<string, typeof establishments>();
    for (const e of establishments) {
      const arr = estByOrg.get(e.organizationId) ?? [];
      arr.push(e);
      estByOrg.set(e.organizationId, arr);
    }
    const memberCountByOrg = new Map<string, number>();
    for (const c of memberCounts) {
      memberCountByOrg.set(c.organizationId, c._count._all);
    }

    // childIds[parentId] -> set de hijos.
    const childrenIndex = new Map<string, string[]>();
    for (const o of allOrgs.values()) {
      if (o.parentId) {
        const arr = childrenIndex.get(o.parentId) ?? [];
        arr.push(o.id);
        childrenIndex.set(o.parentId, arr);
      }
    }

    function buildNode(id: string): OrgTreeNode {
      const o = allOrgs.get(id)!;
      const childIds = childrenIndex.get(id) ?? [];
      const ests = estByOrg.get(id) ?? [];
      return {
        id: o.id,
        legalName: o.legalName,
        tradeName: o.tradeName ?? o.legalName,
        type: o.parentId === null ? "HOLDING" : "COMPANY",
        active: o.active,
        parentId: o.parentId,
        children: childIds.map(buildNode).sort((a, b) =>
          a.tradeName.localeCompare(b.tradeName),
        ),
        establishments: ests.map((e) => ({
          id: e.id,
          code: e.code,
          name: e.name,
          type: "ESTABLISHMENT" as const,
          active: e.active,
        })),
        membersCount: memberCountByOrg.get(id) ?? 0,
      };
    }

    // Roots = orgs sin parent dentro del set (bosque).
    const roots = Array.from(allOrgs.values())
      .filter((o) => o.parentId === null || !allOrgs.has(o.parentId))
      .map((o) => buildNode(o.id))
      .sort((a, b) => a.tradeName.localeCompare(b.tradeName));

    return roots;
  }),
});
