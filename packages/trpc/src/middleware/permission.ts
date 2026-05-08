/**
 * Permission middleware para tRPC procedures.
 *
 * Composable sobre `tenantProcedure`:
 *   const procedure = tenantProcedure.use(requirePermission("pharmacy.prescribe"));
 *
 * Carga UserOrganizationRole → Role → RolePermission → Permission en una query.
 * Aplica deny-overrides (DENY > ALLOW si ambos existen). Bypass para roles ADMIN_GLOBAL/ADMIN.
 */
import { TRPCError, initTRPC } from "@trpc/server";
import type { TRPCContext } from "../context";

const t = initTRPC.context<TRPCContext>().create();
const ADMIN_ROLE_CODES = new Set(["ADMIN_GLOBAL", "ADMIN"]);

async function loadUserPermissions(ctx: TRPCContext) {
  if (!ctx.user || !ctx.tenant) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sesión y tenant requeridos." });
  }
  const uors = await ctx.prisma.userOrganizationRole.findMany({
    where: {
      userId: ctx.user.id,
      organizationId: ctx.tenant.organizationId,
      validTo: null,
    },
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  const allowed = new Set<string>();
  const denied = new Set<string>();
  let isAdmin = false;

  for (const uor of uors) {
    if (ADMIN_ROLE_CODES.has(uor.role.code)) isAdmin = true;
    for (const rp of uor.role.permissions) {
      (rp.effect === "DENY" ? denied : allowed).add(rp.permission.code);
    }
  }
  for (const d of denied) allowed.delete(d);
  return { codes: allowed, isAdmin };
}

export function requirePermission(code: string) {
  return t.middleware(async ({ ctx, next }) => {
    const { codes, isAdmin } = await loadUserPermissions(ctx);
    if (!isAdmin && !codes.has(code)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Permiso requerido: ${code}` });
    }
    return next({ ctx: { ...ctx, permissions: codes } });
  });
}

export function requirePermissions(codes: string[]) {
  return t.middleware(async ({ ctx, next }) => {
    const { codes: have, isAdmin } = await loadUserPermissions(ctx);
    if (!isAdmin) {
      const missing = codes.filter((c) => !have.has(c));
      if (missing.length) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Permiso requerido: ${missing.join(", ")}`,
        });
      }
    }
    return next({ ctx: { ...ctx, permissions: have } });
  });
}

export function requireAnyPermission(codes: string[]) {
  return t.middleware(async ({ ctx, next }) => {
    const { codes: have, isAdmin } = await loadUserPermissions(ctx);
    if (!isAdmin && !codes.some((c) => have.has(c))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permiso requerido: ${codes.join(" | ")}`,
      });
    }
    return next({ ctx: { ...ctx, permissions: have } });
  });
}
