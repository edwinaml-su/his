import { z } from "zod";
import { Prisma } from "@his/database";
import { router, tenantProcedure, protectedProcedure } from "../trpc";
import {
  listOrgChangesInputSchema,
  type AuditLogEntryDTO,
} from "@his/contracts";

/**
 * Calcula la lista de keys cuyos valores difieren entre `before` y `after`.
 * Heurística simple: comparación por JSON.stringify por campo top-level.
 * Suficiente para el resumen de "diff" en la UI; el detalle completo se
 * obtiene haciendo click en la fila.
 */
function diffChangedFields(
  before: Prisma.JsonValue | null,
  after: Prisma.JsonValue | null,
): string[] {
  if (!before || !after) {
    if (after && typeof after === "object" && !Array.isArray(after)) {
      return Object.keys(after as Record<string, unknown>);
    }
    if (before && typeof before === "object" && !Array.isArray(before)) {
      return Object.keys(before as Record<string, unknown>);
    }
    return [];
  }
  if (typeof before !== "object" || typeof after !== "object") return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed.push(k);
  }
  return changed;
}

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

  /**
   * US-1.8 — visor de cambios estructurales (Organization + Establishment).
   *
   * `protectedProcedure` (no `tenantProcedure`) porque el holding root puede
   * vivir en una org distinta de la activa, y queremos mostrar la jerarquía
   * completa donde el usuario tiene roles. Filtramos por las orgs del usuario.
   *
   * Filtros:
   *   - entityKind: ALL (default) | Organization | Establishment.
   *   - organizationId: cuando se quiere foco en una org/establishment puntual.
   *   - action: CREATE/UPDATE/DELETE etc.
   *   - userId: actor que originó el cambio.
   *   - from/to: rango de fechas (ISO).
   */
  listOrgChanges: protectedProcedure
    .input(listOrgChangesInputSchema)
    .query(async ({ ctx, input }) => {
      // Boundary multi-tenant: limitamos a las orgs del usuario.
      const now = new Date();
      const memberships = await ctx.prisma.userOrganizationRole.findMany({
        where: {
          userId: ctx.user.id,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
        select: { organizationId: true },
      });
      const allowedOrgIds = Array.from(
        new Set(memberships.map((m) => m.organizationId)),
      );
      if (allowedOrgIds.length === 0) {
        return { items: [], total: 0, page: input.page, pageSize: input.pageSize };
      }

      const entityFilter =
        input.entityKind === "ALL"
          ? { in: ["Organization", "Establishment"] as string[] }
          : input.entityKind;

      const where: Prisma.AuditLogWhereInput = {
        organizationId: { in: allowedOrgIds },
        entity: entityFilter,
        ...(input.organizationId ? { entityId: input.organizationId } : {}),
        ...(input.action ? { action: input.action } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.from || input.to
          ? {
              occurredAt: {
                ...(input.from ? { gte: input.from } : {}),
                ...(input.to ? { lte: input.to } : {}),
              },
            }
          : {}),
      };

      const [rawItems, total] = await Promise.all([
        ctx.prisma.auditLog.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          orderBy: { occurredAt: "desc" },
        }),
        ctx.prisma.auditLog.count({ where }),
      ]);

      // Resolver labels de usuario en bulk para evitar N+1.
      const userIds = Array.from(
        new Set(rawItems.map((i) => i.userId).filter((u): u is string => !!u)),
      );
      const users = userIds.length
        ? await ctx.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, fullName: true, email: true },
          })
        : [];
      const userMap = new Map(users.map((u) => [u.id, u.fullName ?? u.email]));

      const items: AuditLogEntryDTO[] = rawItems.map((i) => ({
        id: i.id.toString(),
        occurredAt: i.occurredAt,
        userId: i.userId,
        userLabel: i.userId ? userMap.get(i.userId) ?? null : null,
        organizationId: i.organizationId,
        action: i.action,
        entity: i.entity,
        entityId: i.entityId,
        beforeJson: i.beforeJson as Prisma.JsonValue,
        afterJson: i.afterJson as Prisma.JsonValue,
        changedFields: diffChangedFields(
          i.beforeJson as Prisma.JsonValue,
          i.afterJson as Prisma.JsonValue,
        ),
        justification: i.justification,
      }));

      return { items, total, page: input.page, pageSize: input.pageSize };
    }),
});
