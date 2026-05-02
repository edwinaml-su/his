/**
 * US-2.3 — router RBAC.
 *
 * Endpoints:
 *   - listRoles      : roles de la org actual + roles globales (organizationId NULL).
 *                      Incluye contadores: usuarios asignados (vigentes) y permisos.
 *   - getRole        : detalle del rol con permisos (RolePermission + Permission).
 *   - createRole     : crea rol en la org actual o global (super_admin).
 *   - updateRole     : edita name/description/active. No mueve organizationId.
 *   - deactivateRole : soft delete (active=false).
 *   - listPermissions: catálogo completo (seed) ordenado por resource+action.
 *   - setRolePermissions: upsert masivo del set de permisos del rol.
 *
 * Reglas:
 *   1. Roles globales (organizationId NULL) sólo pueden ser creados/modificados
 *      por usuarios con rol `super_admin`. El check usa ctx.tenant.roleCodes.
 *   2. Roles de organización: el usuario debe pertenecer a la org del rol.
 *   3. setRolePermissions reemplaza el set actual atomicamente
 *      (deleteMany + createMany dentro de tx). El cliente envía el listado
 *      completo deseado (ALLOW/DENY) — los permisos no enviados se "des-asignan".
 *
 * El schema NO se modifica.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@his/database";
import {
  rbacListRolesInput,
  rbacGetRoleInput,
  rbacCreateRoleInput,
  rbacUpdateRoleInput,
  rbacDeactivateRoleInput,
  rbacSetRolePermissionsInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

const SUPER_ADMIN_CODE = "super_admin";

function isSuperAdmin(roleCodes: string[]): boolean {
  return roleCodes.some((c) => c.toLowerCase() === SUPER_ADMIN_CODE);
}

/** P2002 / P2025 → TRPCError con mensaje es-SV. */
function rethrowPrisma(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ya existe un rol con ese código en la organización.",
      });
    }
    if (err.code === "P2025") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Rol no encontrado." });
    }
  }
  throw err;
}

export const rbacRouter = router({
  /**
   * Lista roles visibles desde el tenant: los de la org actual + los globales.
   * Trae contadores agregados (usuarios vigentes y permisos asignados).
   */
  listRoles: tenantProcedure.input(rbacListRolesInput).query(async ({ ctx, input }) => {
    const orgId = ctx.tenant.organizationId;
    const includeGlobal = input.includeGlobal ?? true;
    const activeOnly = input.activeOnly ?? true;

    const where: Prisma.RoleWhereInput = {
      AND: [
        includeGlobal
          ? { OR: [{ organizationId: orgId }, { organizationId: null }] }
          : { organizationId: orgId },
        activeOnly ? { active: true } : {},
        input.search
          ? {
              OR: [
                { code: { contains: input.search, mode: "insensitive" } },
                { name: { contains: input.search, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    };

    const roles = await ctx.prisma.role.findMany({
      where,
      orderBy: [{ organizationId: "asc" }, { code: "asc" }],
      include: {
        _count: {
          select: { permissions: true, userRoles: true },
        },
        permissions: {
          select: { effect: true },
        },
      },
    });

    // Total de permisos en el catálogo (denominador del badge ALL/ACTIVE/PARTIAL).
    const totalPermissions = await ctx.prisma.permission.count();

    const now = new Date();
    // Conteo de usuarios vigentes por rol (no expirados). El _count.userRoles
    // incluye expirados, así que recalculamos en una consulta agrupada.
    const liveCounts = await ctx.prisma.userOrganizationRole.groupBy({
      by: ["roleId"],
      where: {
        roleId: { in: roles.map((r) => r.id) },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      _count: { _all: true },
    });
    const liveByRole = new Map<string, number>(
      liveCounts.map((c) => [c.roleId, c._count._all]),
    );

    return roles.map((r) => {
      const allowCount = r.permissions.filter((p) => p.effect === "ALLOW").length;
      return {
        id: r.id,
        organizationId: r.organizationId,
        code: r.code,
        name: r.name,
        description: r.description,
        active: r.active,
        userCount: liveByRole.get(r.id) ?? 0,
        allowCount,
        permissionCount: r._count.permissions,
        totalPermissions,
        /** Etiqueta para badge: ALL si todos ALLOW, NONE si vacío, PARTIAL en el medio. */
        coverage:
          totalPermissions === 0
            ? "NONE"
            : allowCount === 0
              ? "NONE"
              : allowCount >= totalPermissions
                ? "ALL"
                : "PARTIAL",
      };
    });
  }),

  /** Detalle del rol con sus RolePermission + Permission. */
  getRole: tenantProcedure.input(rbacGetRoleInput).query(async ({ ctx, input }) => {
    const role = await ctx.prisma.role.findUnique({
      where: { id: input.id },
      include: {
        permissions: { include: { permission: true } },
      },
    });
    if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Rol no encontrado." });

    // Boundary tenant: si es de otra org y no es global, denegar.
    if (
      role.organizationId !== null &&
      role.organizationId !== ctx.tenant.organizationId
    ) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Rol fuera de tu organización." });
    }

    return {
      id: role.id,
      organizationId: role.organizationId,
      code: role.code,
      name: role.name,
      description: role.description,
      active: role.active,
      permissions: role.permissions.map((rp) => ({
        permissionId: rp.permissionId,
        effect: rp.effect,
        permission: {
          id: rp.permission.id,
          code: rp.permission.code,
          resource: rp.permission.resource,
          action: rp.permission.action,
        },
      })),
    };
  }),

  /**
   * Crea un rol. Si organizationId === null → global (sólo super_admin).
   * Si undefined → la org actual del tenant.
   */
  createRole: tenantProcedure.input(rbacCreateRoleInput).mutation(async ({ ctx, input }) => {
    const wantsGlobal = input.organizationId === null;
    if (wantsGlobal && !isSuperAdmin(ctx.tenant.roleCodes)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sólo super_admin puede crear roles globales.",
      });
    }
    const orgId = wantsGlobal ? null : (input.organizationId ?? ctx.tenant.organizationId);
    if (orgId !== null && orgId !== ctx.tenant.organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No puedes crear roles en otra organización.",
      });
    }
    try {
      return await ctx.prisma.role.create({
        data: {
          organizationId: orgId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          active: true,
        },
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  /** Edita un rol. Roles globales sólo super_admin. */
  updateRole: tenantProcedure.input(rbacUpdateRoleInput).mutation(async ({ ctx, input }) => {
    const role = await ctx.prisma.role.findUnique({ where: { id: input.id } });
    if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Rol no encontrado." });

    if (role.organizationId === null && !isSuperAdmin(ctx.tenant.roleCodes)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sólo super_admin puede modificar roles globales.",
      });
    }
    if (role.organizationId !== null && role.organizationId !== ctx.tenant.organizationId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Rol fuera de tu organización." });
    }

    try {
      return await ctx.prisma.role.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  /** Soft delete: active=false. NO borra UserOrganizationRole asociados (auditable). */
  deactivateRole: tenantProcedure
    .input(rbacDeactivateRoleInput)
    .mutation(async ({ ctx, input }) => {
      const role = await ctx.prisma.role.findUnique({ where: { id: input.id } });
      if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Rol no encontrado." });
      if (role.organizationId === null && !isSuperAdmin(ctx.tenant.roleCodes)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sólo super_admin puede desactivar roles globales.",
        });
      }
      if (role.organizationId !== null && role.organizationId !== ctx.tenant.organizationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Rol fuera de tu organización." });
      }
      return ctx.prisma.role.update({
        where: { id: input.id },
        data: { active: false },
      });
    }),

  /**
   * Catálogo completo de permisos disponible (Permission es seed global,
   * no tiene organizationId). Ordenado por resource+action para la UI matriz.
   */
  listPermissions: tenantProcedure
    .input(z.object({ search: z.string().trim().max(120).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const where: Prisma.PermissionWhereInput = input.search
        ? {
            OR: [
              { code: { contains: input.search, mode: "insensitive" } },
              { resource: { contains: input.search, mode: "insensitive" } },
              { action: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : {};
      return ctx.prisma.permission.findMany({
        where,
        orderBy: [{ resource: "asc" }, { action: "asc" }],
      });
    }),

  /**
   * Reemplaza el set de permisos del rol.
   *  - Sin transacción → operación atómica vía $transaction.
   *  - Idempotente: enviar el mismo input 2x produce el mismo estado.
   *  - Si un permissionId no existe en Permission, falla por FK (P2003)
   *    y devolvemos BAD_REQUEST.
   */
  setRolePermissions: tenantProcedure
    .input(rbacSetRolePermissionsInput)
    .mutation(async ({ ctx, input }) => {
      const role = await ctx.prisma.role.findUnique({ where: { id: input.roleId } });
      if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Rol no encontrado." });

      // Boundary + super_admin para roles globales.
      if (role.organizationId === null && !isSuperAdmin(ctx.tenant.roleCodes)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sólo super_admin puede modificar permisos de roles globales.",
        });
      }
      if (role.organizationId !== null && role.organizationId !== ctx.tenant.organizationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Rol fuera de tu organización." });
      }

      // Dedupe por permissionId (gana el último).
      const map = new Map<string, "ALLOW" | "DENY">();
      for (const p of input.permissions) {
        map.set(p.permissionId, p.effect);
      }
      const desired = Array.from(map, ([permissionId, effect]) => ({ permissionId, effect }));

      try {
        await ctx.prisma.$transaction([
          ctx.prisma.rolePermission.deleteMany({ where: { roleId: input.roleId } }),
          ...(desired.length > 0
            ? [
                ctx.prisma.rolePermission.createMany({
                  data: desired.map((p) => ({
                    roleId: input.roleId,
                    permissionId: p.permissionId,
                    effect: p.effect,
                  })),
                  skipDuplicates: true,
                }),
              ]
            : []),
        ]);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Algún permissionId no existe en el catálogo.",
          });
        }
        throw err;
      }

      return { ok: true, count: desired.length };
    }),
});
