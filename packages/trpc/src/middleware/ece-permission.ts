/**
 * Middleware tRPC — requireEcePermission.
 *
 * Extiende `requireRole` (trpc.ts) con lógica granular ECE sin consulta a BD.
 * Evalúa en memoria usando TenantContext.roleCodes — idóneo para permisos ECE
 * que siguen el mapeo de roles y no requieren query adicional por request.
 *
 * Diferencia respecto a requirePermission (middleware/permission.ts):
 *   - requirePermission → BD (UserOrganizationRole → RolePermission): permisos
 *     configurables por organización.
 *   - requireEcePermission → en memoria (roleCodes): permisos ECE basados en
 *     rol. Misma lógica que @his/contracts/ece-permissions (mantenida en sync).
 *
 * La lógica está inlined aquí para evitar imports cross-package fuera de rootDir.
 * El tipo EcePermission es importado desde @his/contracts cuando el symlink está
 * disponible; en worktrees se re-declara aquí para mantener type-safety.
 */
import { TRPCError, initTRPC } from "@trpc/server";
import type { TRPCContext } from "../context";

// Re-declarado aquí para independencia del symlink en worktrees.
// Debe mantenerse en sync con packages/contracts/src/schemas/ece-permissions.ts.
export type EcePermission =
  | "ece.documento.firmar"
  | "ece.documento.validar"
  | "ece.documento.certificar"
  | "ece.documento.anular"
  | "ece.bitacora.read"
  | "ece.rectificacion.solicitar"
  | "ece.rectificacion.aprobar"
  | "ece.workflow.designer";

const ADMIN_CODES    = new Set(["ADMIN", "ADMIN_GLOBAL", "super_admin", "admin_clinico"]);
const DIR_CODES      = new Set(["DIR"]);
const ARCH_CODES     = new Set(["ARCH"]);
const PHYSICIAN_CODES = new Set(["PHYSICIAN", "medico", "MC", "MT"]);
const NURSE_CODES    = new Set(["NURSE", "enfermeria", "ENF"]);
const ESP_CODES      = new Set(["ESP"]);

function hasAny(codes: readonly string[], set: Set<string>): boolean {
  return codes.some((c) => set.has(c));
}

function checkEcePermission(permission: EcePermission, roleCodes: readonly string[]): boolean {
  if (hasAny(roleCodes, ADMIN_CODES)) return true;

  switch (permission) {
    case "ece.documento.firmar":
      return (
        hasAny(roleCodes, PHYSICIAN_CODES) ||
        hasAny(roleCodes, NURSE_CODES) ||
        hasAny(roleCodes, ESP_CODES)
      );
    case "ece.documento.validar":
      return hasAny(roleCodes, PHYSICIAN_CODES);
    case "ece.documento.certificar":
      return hasAny(roleCodes, DIR_CODES);
    case "ece.documento.anular":
      return hasAny(roleCodes, DIR_CODES);
    case "ece.bitacora.read":
      return hasAny(roleCodes, DIR_CODES) || hasAny(roleCodes, ARCH_CODES);
    case "ece.rectificacion.solicitar":
      return hasAny(roleCodes, PHYSICIAN_CODES) || hasAny(roleCodes, NURSE_CODES);
    case "ece.rectificacion.aprobar":
      return hasAny(roleCodes, DIR_CODES);
    case "ece.workflow.designer":
      return hasAny(roleCodes, DIR_CODES);
    default: {
      const _exhaustive: never = permission;
      return false;
    }
  }
}

const t = initTRPC.context<TRPCContext>().create();

/**
 * Procedure-base con verificación de permiso ECE.
 *
 * Uso en router:
 *   requireEcePermission("ece.documento.certificar")
 *     .input(schema)
 *     .mutation(handler)
 */
export function requireEcePermission(permission: EcePermission) {
  return t.procedure.use(({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Sesión requerida." });
    }
    if (!ctx.tenant) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Selecciona una organización antes de continuar.",
      });
    }

    if (!checkEcePermission(permission, ctx.tenant.roleCodes)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permiso ECE requerido: ${permission}`,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user, tenant: ctx.tenant } });
  });
}
