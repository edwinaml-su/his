/**
 * US-2.3 / F2-S15-D — router RBAC.
 *
 * Endpoints:
 *   - listRoles          : roles de la org actual + roles globales (organizationId NULL).
 *   - getRole            : detalle del rol con permisos.
 *   - createRole         : crea rol en la org actual o global (super_admin).
 *   - updateRole         : edita name/description/active.
 *   - deactivateRole     : soft delete (active=false).
 *   - listPermissions    : catálogo completo ordenado por resource+action.
 *   - setRolePermissions : upsert masivo del set de permisos.
 *   - permissionMatrix   : tabla pivot user × resource × action (US.F2.7.21).
 *   - purgeInactiveUsers : detecta y marca usuarios inactivos >1 año (US.F2.7.20).
 *   - reactivateUser     : reactiva usuario inactivo con motivo (US.F2.7.20).
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
import { requireRole, router, tenantProcedure } from "../trpc";

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
    // Si el caller pidió una org específica (multi-org admin asignando a
    // otra org), valida que tenga membresía vigente allí antes de devolver
    // roles. Esto evita que un user filtre roles de orgs sin acceso.
    let orgId = ctx.tenant.organizationId;
    if (input.organizationId && input.organizationId !== orgId) {
      const now = new Date();
      const membership = await ctx.prisma.userOrganizationRole.findFirst({
        where: {
          userId: ctx.user.id,
          organizationId: input.organizationId,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
        select: { id: true },
      });
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tienes membresía vigente en la organización solicitada.",
        });
      }
      orgId = input.organizationId;
    }

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

  /**
   * US.F2.7.21 — Reporte "quién tiene qué permiso".
   * Retorna una tabla pivot: usuario × recurso × acción con effect (ALLOW/DENY).
   * Solo super_admin o DIR pueden ver la matriz completa.
   */
  permissionMatrix: requireRole(["DIR", "super_admin"])
    .input(z.object({
      // Filtro opcional por recurso
      resource: z.string().trim().max(120).optional(),
      // Solo usuarios vigentes (validTo IS NULL OR >= now)
      activeOnly: z.boolean().default(true),
    }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const now   = new Date();

      // Obtener usuarios con roles activos en la org
      const userRoles = await ctx.prisma.userOrganizationRole.findMany({
        where: {
          role: {
            OR: [{ organizationId: orgId }, { organizationId: null }],
          },
          ...(input.activeOnly
            ? {
                validFrom: { lte: now },
                OR: [{ validTo: null }, { validTo: { gte: now } }],
              }
            : {}),
        },
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true },
                where: input.resource
                  ? { permission: { resource: input.resource } }
                  : undefined,
              },
            },
          },
          user: { select: { id: true, fullName: true, email: true } },
        },
      });

      // Construir mapa: userId → { userInfo, permissions: Map<resource:action, effect> }
      type MatrixEntry = {
        userId:   string;
        fullName: string;
        email:    string;
        permissions: Array<{
          resource: string;
          action:   string;
          effect:   "ALLOW" | "DENY";
        }>;
      };

      const matrixMap = new Map<string, MatrixEntry>();

      for (const ur of userRoles) {
        const userId = ur.userId;
        if (!matrixMap.has(userId)) {
          matrixMap.set(userId, {
            userId,
            fullName: ur.user.fullName,
            email:    ur.user.email,
            permissions: [],
          });
        }
        const entry = matrixMap.get(userId)!;
        for (const rp of ur.role.permissions) {
          // ALLOW gana sobre DENY si hay conflicto (policy local)
          const existing = entry.permissions.find(
            (p) => p.resource === rp.permission.resource && p.action === rp.permission.action,
          );
          if (!existing) {
            entry.permissions.push({
              resource: rp.permission.resource,
              action:   rp.permission.action,
              effect:   rp.effect as "ALLOW" | "DENY",
            });
          } else if (rp.effect === "ALLOW") {
            existing.effect = "ALLOW";
          }
        }
      }

      return {
        users: Array.from(matrixMap.values()),
        totalUsers: matrixMap.size,
      };
    }),

  /**
   * US.F2.7.20 — Depuración anual de usuarios inactivos.
   * Detecta usuarios cuyo lastLoginAt < now() - 1 año y los marca INACTIVE.
   * Notifica al DIR (outbox simple: DomainEvent).
   * Solo super_admin o DIR pueden ejecutar.
   */
  purgeInactiveUsers: requireRole(["DIR", "super_admin"])
    .input(z.object({
      dryRun: z.boolean().default(true),
      // inactividad en días (default: 365)
      inactiveDays: z.number().int().min(30).max(3650).default(365),
    }))
    .mutation(async ({ ctx, input }) => {
      const cutoff = new Date(Date.now() - input.inactiveDays * 24 * 60 * 60 * 1000);

      // Buscar usuarios activos que llevan más de inactiveDays sin login
      const candidates = await ctx.prisma.user.findMany({
        where: {
          active:      true,
          lastLoginAt: { lt: cutoff },
        },
        select: { id: true, fullName: true, email: true, lastLoginAt: true },
      });

      if (input.dryRun || candidates.length === 0) {
        return { dryRun: true, affected: candidates.length, users: candidates };
      }

      // Marcar accountStatus=INACTIVE via raw (campo aún no en Prisma schema, migración 04)
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE public."User"
         SET "accountStatus" = 'INACTIVE'
         WHERE id = ANY($1::uuid[])`,
        candidates.map((u) => u.id),
      );

      // Emitir evento de dominio para notificación DIR (best-effort)
      ctx.prisma.domainEvent.createMany({
        data: candidates.map((u) => ({
          eventType:      "user.purged_inactive",
          aggregateType:  "User",
          aggregateId:    u.id,
          organizationId: ctx.tenant.organizationId,
          emittedById:    ctx.user.id,
          payload:        JSON.stringify({ userId: u.id, email: u.email, lastLoginAt: u.lastLoginAt }),
        })),
      }).catch((e: unknown) => console.error("[rbac.purgeInactiveUsers] evento:", e));

      return { dryRun: false, affected: candidates.length, users: candidates };
    }),

  /**
   * US.F2.7.20 — Reactiva usuario INACTIVE con motivo.
   * Solo ADM puede reactivar.
   */
  reactivateUser: requireRole(["ADM", "super_admin"])
    .input(z.object({
      userId: z.string().uuid(),
      motivo: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$executeRawUnsafe(
        `UPDATE public."User"
         SET "accountStatus" = 'ACTIVE'
         WHERE id = $1::uuid`,
        input.userId,
      );

      // Auditoría del motivo en DomainEvent
      await ctx.prisma.domainEvent.create({
        data: {
          eventType:      "user.reactivated",
          aggregateType:  "User",
          aggregateId:    input.userId,
          organizationId: ctx.tenant.organizationId,
          emittedById:    ctx.user.id,
          payload:        JSON.stringify({ motivo: input.motivo }),
        },
      });

      return { ok: true as const };
    }),
});
