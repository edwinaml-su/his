/**
 * Permisos granulares ECE — helper client/server de apps/web.
 *
 * Misma lógica que packages/contracts/src/schemas/ece-permissions.ts
 * y packages/trpc/src/middleware/ece-permission.ts.
 * Se mantiene en sync manualmente; las tres copias son idénticas en lógica.
 *
 * Razón de la duplicación: el tsconfig de Next.js y los worktrees de git
 * no resuelven imports cross-package fuera de rootDir ni de los symlinks
 * del monorepo raíz. La lógica es pura (sin dependencias), por lo que
 * duplicarla es el trade-off correcto sobre la complejidad alternativa.
 */

export type EcePermission =
  | "ece.documento.firmar"
  | "ece.documento.validar"
  | "ece.documento.certificar"
  | "ece.documento.anular"
  | "ece.bitacora.read"
  | "ece.rectificacion.solicitar"
  | "ece.rectificacion.aprobar"
  | "ece.workflow.designer"
  // Permisos quirúrgicos / obstétricos / neonatales (75_specialized_roles.sql)
  | "ece.cirugia.programar"
  | "ece.cirugia.firmar_acto"
  | "ece.anestesia.administrar"
  | "ece.urpa.dar_alta"
  | "ece.partograma.registrar"
  | "ece.rn.firmar"
  | "ece.reanimacion.ejecutar";

const ADMIN_CODES     = new Set(["ADMIN", "ADMIN_GLOBAL", "super_admin", "admin_clinico"]);
const DIR_CODES       = new Set(["DIR"]);
const ARCH_CODES      = new Set(["ARCH"]);
const PHYSICIAN_CODES = new Set(["PHYSICIAN", "medico", "MC", "MT"]);
const NURSE_CODES     = new Set(["NURSE", "enfermeria", "ENF"]);
const ESP_CODES       = new Set(["ESP"]);
const ANEST_CODES     = new Set(["ANEST"]);
const GO_CODES        = new Set(["GO"]);
const PEDIA_CODES     = new Set(["PEDIA"]);
const ENF_NRP_CODES   = new Set(["ENF_NRP"]);

function hasAny(roleCodes: readonly string[], set: Set<string>): boolean {
  return roleCodes.some((c) => set.has(c));
}

export function hasEcePermission(
  permission: EcePermission,
  context: { roleCodes: readonly string[]; ecePersonalRoles?: string[] },
): boolean {
  const { roleCodes } = context;
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
    case "ece.cirugia.programar":
      return (
        hasAny(roleCodes, PHYSICIAN_CODES) ||
        hasAny(roleCodes, ESP_CODES) ||
        hasAny(roleCodes, GO_CODES)
      );
    case "ece.cirugia.firmar_acto":
      return hasAny(roleCodes, ESP_CODES);
    case "ece.anestesia.administrar":
      return hasAny(roleCodes, ANEST_CODES);
    case "ece.urpa.dar_alta":
      return hasAny(roleCodes, NURSE_CODES) || hasAny(roleCodes, ENF_NRP_CODES);
    case "ece.partograma.registrar":
      return (
        hasAny(roleCodes, NURSE_CODES) ||
        hasAny(roleCodes, PHYSICIAN_CODES) ||
        hasAny(roleCodes, GO_CODES)
      );
    case "ece.rn.firmar":
      return hasAny(roleCodes, PEDIA_CODES);
    case "ece.reanimacion.ejecutar":
      return hasAny(roleCodes, PEDIA_CODES) || hasAny(roleCodes, ENF_NRP_CODES);
    default: {
      const _exhaustive: never = permission;
      return false;
    }
  }
}
