/**
 * US-2.3 — router de administración de usuarios.
 *
 * Endpoints:
 *   - listAll        : paginado, filtros (active, roleCode, search por email/nombre).
 *   - get            : detalle + roles vigentes/históricos por organización.
 *   - create         : crea User local SIN tocar Supabase Auth (ver invitation flow).
 *   - update         : edita fullName / active.
 *   - deactivate     : soft-disable (active=false). No borra.
 *   - assignRole     : crea UserOrganizationRole con validFrom=now (idempotente).
 *   - revokeRole     : setea validTo=now en la membresía vigente.
 *
 * Invitation flow stub (Sprint 1):
 *   `create` solo persiste User { active=true, mfaEnabled=false }. NO se crea
 *   Auth user en Supabase ni se envía magic-link. La idea es que, en
 *   Sprint 2, una mutación `userAdmin.invite` complete el flujo:
 *     1. Crea o reutiliza el User local.
 *     2. Llama Supabase admin API `inviteUserByEmail` (o `generateLink` con
 *        type=invite) para emitir un magic-link.
 *     3. Linkea `auth.users.id` al User local mediante UserExternalIdentity
 *        (provider=OIDC, issuer=supabase) cuando el invitado abre el link.
 *
 * El schema NO se modifica.
 */
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import {
  userAdminListAllInput,
  userAdminGetInput,
  userAdminCreateInput,
  userAdminUpdateInput,
  userAdminDeactivateInput,
  userAdminAssignRoleInput,
  userAdminRevokeRoleInput,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

function rethrowPrisma(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ya existe un usuario con ese email.",
      });
    }
    if (err.code === "P2025") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Recurso no encontrado." });
    }
  }
  throw err;
}

export const userAdminRouter = router({
  /**
   * Listado paginado de usuarios. El alcance es global por simplicidad MVP
   * (TODO Sprint 2: filtrar por usuarios visibles a la org del tenant).
   */
  listAll: tenantProcedure.input(userAdminListAllInput).query(async ({ ctx, input }) => {
    const where: Prisma.UserWhereInput = {};
    if (input.active !== undefined) where.active = input.active;
    if (input.search) {
      where.OR = [
        { email: { contains: input.search, mode: "insensitive" } },
        { fullName: { contains: input.search, mode: "insensitive" } },
      ];
    }
    if (input.roleCode) {
      where.roles = {
        some: {
          role: { code: input.roleCode },
          validFrom: { lte: new Date() },
          OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
        },
      };
    }

    const total = await ctx.prisma.user.count({ where });
    const skip = (input.page - 1) * input.pageSize;

    const users = await ctx.prisma.user.findMany({
      where,
      orderBy: [{ active: "desc" }, { fullName: "asc" }],
      skip,
      take: input.pageSize,
      select: {
        id: true,
        email: true,
        fullName: true,
        active: true,
        mfaEnabled: true,
        lastLoginAt: true,
        _count: { select: { roles: true } },
      },
    });

    // Conteo de roles VIGENTES por usuario (más fiel que _count.roles total).
    const now = new Date();
    const liveRoles = await ctx.prisma.userOrganizationRole.groupBy({
      by: ["userId"],
      where: {
        userId: { in: users.map((u) => u.id) },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      _count: { _all: true },
    });
    const liveByUser = new Map<string, number>(
      liveRoles.map((r) => [r.userId, r._count._all]),
    );

    return {
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        active: u.active,
        mfaEnabled: u.mfaEnabled,
        lastLoginAt: u.lastLoginAt,
        activeRoleCount: liveByUser.get(u.id) ?? 0,
        totalRoleCount: u._count.roles,
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }),

  /** Detalle de un usuario con todas sus membresías (vigentes e históricas). */
  get: tenantProcedure.input(userAdminGetInput).query(async ({ ctx, input }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: input.id },
      include: {
        roles: {
          orderBy: [{ validTo: "asc" }, { validFrom: "desc" }],
          include: {
            role: { select: { id: true, code: true, name: true, organizationId: true } },
            organization: { select: { id: true, tradeName: true, legalName: true } },
          },
        },
      },
    });
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });

    const now = new Date();
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      active: user.active,
      mfaEnabled: user.mfaEnabled,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles: user.roles.map((m) => ({
        id: m.id,
        userId: m.userId,
        organizationId: m.organizationId,
        roleId: m.roleId,
        validFrom: m.validFrom,
        validTo: m.validTo,
        active: m.validFrom <= now && (m.validTo === null || m.validTo >= now),
        role: m.role,
        organization: m.organization,
      })),
    };
  }),

  /**
   * Crea un User local. STUB invitation flow:
   *   - active=true, mfaEnabled=false.
   *   - NO toca Supabase Auth ni envía emails (TODO Sprint 2).
   * Si el email ya existe, devuelve CONFLICT (no upsert silencioso).
   */
  create: tenantProcedure.input(userAdminCreateInput).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.prisma.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          active: true,
          mfaEnabled: false,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        },
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  update: tenantProcedure.input(userAdminUpdateInput).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.prisma.user.update({
        where: { id: input.id },
        data: {
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedBy: ctx.user.id,
        },
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  /**
   * Soft-disable. NO revoca membresías vigentes (auditable). El login
   * verificará `active=false` y bloqueará.
   */
  deactivate: tenantProcedure
    .input(userAdminDeactivateInput)
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No puedes desactivar tu propio usuario.",
        });
      }
      return ctx.prisma.user.update({
        where: { id: input.id },
        data: { active: false, updatedBy: ctx.user.id },
      });
    }),

  /**
   * Asigna un rol al usuario en una organización. Idempotente: si ya hay una
   * UserOrganizationRole vigente con el mismo (user, org, role) → no-op.
   * Si existe una expirada (validTo < now) o la combinación @@unique ya
   * existe pero está cerrada, reactivamos extendiendo validTo a NULL.
   */
  assignRole: tenantProcedure
    .input(userAdminAssignRoleInput)
    .mutation(async ({ ctx, input }) => {
      // Validar pertenencia del rol: rol global o de esa misma org.
      const role = await ctx.prisma.role.findUnique({ where: { id: input.roleId } });
      if (!role || !role.active) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Rol no encontrado o inactivo." });
      }
      if (role.organizationId !== null && role.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El rol no pertenece a la organización indicada.",
        });
      }

      const now = new Date();
      // Hay una @@unique([userId, organizationId, roleId]) → como mucho una fila.
      const existing = await ctx.prisma.userOrganizationRole.findUnique({
        where: {
          userId_organizationId_roleId: {
            userId: input.userId,
            organizationId: input.organizationId,
            roleId: input.roleId,
          },
        },
      });

      if (existing) {
        const isLive =
          existing.validFrom <= now && (existing.validTo === null || existing.validTo >= now);
        if (isLive) return existing; // no-op idempotente
        // Reabrir: extender ventana.
        return ctx.prisma.userOrganizationRole.update({
          where: { id: existing.id },
          data: { validFrom: now, validTo: null },
        });
      }

      try {
        return await ctx.prisma.userOrganizationRole.create({
          data: {
            userId: input.userId,
            organizationId: input.organizationId,
            roleId: input.roleId,
            validFrom: now,
          },
        });
      } catch (err) {
        rethrowPrisma(err);
      }
    }),

  /**
   * Revoca el rol vigente: setea validTo=now en la membresía.
   * Si no hay vigente, no-op (devolvemos null).
   */
  revokeRole: tenantProcedure
    .input(userAdminRevokeRoleInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const existing = await ctx.prisma.userOrganizationRole.findUnique({
        where: {
          userId_organizationId_roleId: {
            userId: input.userId,
            organizationId: input.organizationId,
            roleId: input.roleId,
          },
        },
      });
      if (!existing) return null;
      const isLive =
        existing.validFrom <= now && (existing.validTo === null || existing.validTo >= now);
      if (!isLive) return existing; // ya estaba revocado
      return ctx.prisma.userOrganizationRole.update({
        where: { id: existing.id },
        data: { validTo: now },
      });
    }),
});
