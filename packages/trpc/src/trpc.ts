/**
 * Inicialización de tRPC v11.
 * Define `t`, los procedimientos públicos/protegidos/tenant.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { TRPCContext } from "./context";

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Requiere usuario autenticado. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sesión requerida." });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Requiere usuario + organización seleccionada (tenant). */
export const tenantProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.tenant) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Selecciona una organización antes de continuar.",
    });
  }
  return next({ ctx: { ...ctx, tenant: ctx.tenant } });
});

/** Helper: verifica que el usuario tenga al menos un rol de los listados. */
export function requireRole(roleCodes: string[]) {
  return tenantProcedure.use(({ ctx, next }) => {
    const has = ctx.tenant.roleCodes.some((r) => roleCodes.includes(r));
    if (!has) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Rol requerido: ${roleCodes.join(", ")}`,
      });
    }
    return next();
  });
}
