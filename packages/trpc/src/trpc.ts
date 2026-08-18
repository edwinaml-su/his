/**
 * Inicialización de tRPC v11.
 * Define `t`, los procedimientos públicos/protegidos/tenant.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { TRPCContext } from "./context";
import { getEffectiveRoleCodes, getEffectivePermissions } from "./rbac/effective-roles";

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
/** Middleware standalone (no ligado a un procedure base) — para helpers como `abacGuard`. */
export const middleware = t.middleware;

/**
 * H4 — OWASP A07:2025: espejo mínimo de `MFA_REQUIRED_ROLE_CODES` (la
 * política completa, con roles y secreto, vive en
 * `apps/web/src/lib/auth/mfa-session.ts`). Aquí solo nos importa "¿está la
 * política prendida en absoluto?" para decidir si `mfaSatisfied === undefined`
 * debe fail-closed (ver `tenantProcedure` abajo). Vacía = política apagada,
 * comportamiento idéntico al de antes de este cambio.
 */
const MFA_POLICY_ENABLED = (process.env.MFA_REQUIRED_ROLE_CODES ?? "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean).length > 0;

/** Requiere usuario autenticado. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sesión requerida." });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * CC-0017 F3 — Registra en `audit.AuditLog` cada request tRPC que corrió con
 * `ctx.tenant.breakGlass === true`. Postgres no soporta triggers BEFORE
 * SELECT (ver comentario en `packages/database/sql/02_audit_triggers.sql`
 * §4), así que las lecturas bajo break-glass NO quedan cubiertas por el
 * trigger genérico de auditoría — este es el único punto que las captura.
 *
 * Best-effort: si el INSERT de auditoría falla, se loggea pero NO se
 * bloquea la respuesta al cliente — el acceso de emergencia ya quedó
 * auditado en la activación (break-glass.router.ts `activate`); perder este
 * registro puntual de "uso" no debe impedir la atención clínica.
 */
async function auditBreakGlassAccess(
  ctx: TRPCContext,
  meta: { path: string; type: string },
): Promise<void> {
  const tenant = ctx.tenant;
  if (!tenant) return;
  try {
    await ctx.prisma.auditLog.create({
      data: {
        userId: ctx.user?.id ?? null,
        organizationId: tenant.organizationId,
        establishmentId: tenant.establishmentId ?? null,
        action: "READ",
        entity: "BreakGlassAccess",
        entityId: tenant.breakGlassSession?.patientId ?? null,
        justification: `break-glass activo: ${meta.type} ${meta.path}`,
        afterJson: {
          path: meta.path,
          type: meta.type,
          patientIdDeclarado: tenant.breakGlassSession?.patientId ?? null,
        },
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[break-glass audit] error registrando acceso:", err);
  }
}

/** Requiere usuario + organización seleccionada (tenant). */
export const tenantProcedure = protectedProcedure.use(async ({ ctx, next, path, type }) => {
  if (!ctx.tenant) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Selecciona una organización antes de continuar.",
    });
  }
  const tenant = ctx.tenant;

  // OWASP A07:2025 — si la política de MFA aplica a los roles de este usuario
  // y la sesión no la satisface, no hay acceso a datos del tenant. La política
  // vive en la capa web (cookie firmada); aquí sólo se consume el veredicto.
  if (ctx.mfaSatisfied === false) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Verificación de segundo factor requerida. Vuelve a iniciar sesión en /mfa.",
    });
  }
  // H4: `undefined` solía significar "no bloquear" incondicionalmente — un
  // caller tenant-scoped que arme el contexto SIN evaluar `mfaSatisfied`
  // (patrón ya visto en `apps/web/src/app/(portal)/portal/verify/actions.ts`,
  // aunque ese caso concreto no llega aquí porque no tiene `tenant`) bypaseaba
  // la política en silencio. Con la política prendida, `undefined` + tenant
  // presente ahora falla cerrado. Con la política apagada (`MFA_POLICY_ENABLED
  // = false`) el comportamiento es bit-idéntico al de antes.
  if (ctx.mfaSatisfied === undefined && MFA_POLICY_ENABLED) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Verificación de segundo factor requerida. Vuelve a iniciar sesión en /mfa.",
    });
  }

  const result = await next({ ctx: { ...ctx, tenant } });
  if (tenant.breakGlass && result.ok) {
    await auditBreakGlassAccess(ctx, { path, type });
  }
  return result;
});

/** Requiere sesión autenticada en el Portal del Paciente (Beta.20). */
export const portalProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.portalAccount) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sesión de portal requerida.",
    });
  }
  return next({ ctx: { ...ctx, portalAccount: ctx.portalAccount } });
});

/**
 * Helper: verifica que el usuario tenga al menos un rol de los listados.
 *
 * CC-0017 — evalúa contra los roles EFECTIVOS (directos ∪ herencia de
 * `Role.inheritsFromRoleId` ∪ alias de `RoleCodeAlias`), no sólo los
 * directos. Esto permite que un rol nuevo (creado en /roles heredando de uno
 * existente) pase los `requireRole([...])` ya escritos en los 376 call sites
 * SIN tocarlos. La firma de la función no cambia.
 *
 * FAIL-SAFE: sin herencia/alias configurados, `getEffectiveRoleCodes` hace
 * fallback a `ctx.tenant.roleCodes` tal cual — el comportamiento es
 * BIT-IDÉNTICO al de antes de CC-0017. Ver
 * `packages/trpc/src/__tests__/rbac/effective-roles.test.ts`.
 */
export function requireRole(roleCodes: string[]) {
  return tenantProcedure.use(async ({ ctx, next }) => {
    const effectiveRoleCodes = await getEffectiveRoleCodes(ctx.prisma, ctx.tenant);
    const has = effectiveRoleCodes.some((r) => roleCodes.includes(r));
    if (!has) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Rol requerido: ${roleCodes.join(", ")}`,
      });
    }
    return next({ ctx: { ...ctx, effectiveRoleCodes } });
  });
}

/**
 * CC-0017 — helper NUEVO, opt-in: verifica un permiso `resource.action` del
 * catálogo `Permission` contra el set efectivo de `RolePermission` de los
 * roles efectivos del tenant (DENY gana sobre ALLOW). No reemplaza
 * `requireRole` en los 376 call sites existentes — sólo se usa en procedures
 * que migren explícitamente (ver ejemplos: `accounting.journalEntry.post`,
 * `rbac.purgeInactiveUsers`, `userAdmin.resetPassword`).
 *
 * A diferencia de `requireRole`, esto SÍ depende de que `RolePermission`
 * tenga datos — sin seed (`194_cc0017_rbac_parametrizable.sql`) deniega por
 * defecto (fail-safe hacia "denegar", apropiado para un gate nuevo que aún
 * no gobierna nada heredado).
 */
export function requirePermission(permissionCode: string) {
  return tenantProcedure.use(async ({ ctx, next }) => {
    const [effectiveRoleCodes, effectivePermissions] = await Promise.all([
      getEffectiveRoleCodes(ctx.prisma, ctx.tenant),
      getEffectivePermissions(ctx.prisma, ctx.tenant),
    ]);
    if (effectivePermissions.get(permissionCode) !== "ALLOW") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permiso requerido: ${permissionCode}`,
      });
    }
    return next({ ctx: { ...ctx, effectiveRoleCodes, effectivePermissions } });
  });
}
