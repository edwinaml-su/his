/**
 * Permisos granulares ECE — capa de autorización sobre roles HIS.
 *
 * Usable tanto en server-side (middleware tRPC) como en client-side
 * (hook useEcePermissions). Mantiene paridad con los roles definidos en
 * ece.rol del esquema Supabase (DIR, MC, MT, ENF, ESP, IC, ARCH, AC, ADM).
 *
 * Separado de abac.ts para no mezclar lógica de recursos genéricos (paciente,
 * servicio) con permisos específicos del workflow ECE.
 */

export type EcePermission =
  | "ece.documento.firmar"
  | "ece.documento.validar"
  | "ece.documento.certificar"
  | "ece.documento.anular"
  | "ece.bitacora.read"
  | "ece.rectificacion.solicitar"
  | "ece.rectificacion.aprobar"
  | "ece.workflow.designer";

// Roles HIS normalizados (ambas familias en/es para suavizar la transición).
const ADMIN_CODES    = new Set(["ADMIN", "ADMIN_GLOBAL", "super_admin", "admin_clinico"]);
const DIR_CODES      = new Set(["DIR"]);
const ARCH_CODES     = new Set(["ARCH"]);
// PHYSICIAN incluye MC (médico cirujano) y MT (médico técnico) del esquema ece.rol.
const PHYSICIAN_CODES = new Set(["PHYSICIAN", "medico", "MC", "MT"]);
const NURSE_CODES     = new Set(["NURSE", "enfermeria", "ENF"]);
// ESP: especialistas con capacidad quirúrgica / obstétrica.
const ESP_CODES      = new Set(["ESP"]);

function hasAny(roleCodes: readonly string[], set: Set<string>): boolean {
  return roleCodes.some((c) => set.has(c));
}

/**
 * Evalúa si el contexto de roles tiene el permiso ECE solicitado.
 *
 * @param permission - Permiso ECE a verificar (EcePermission union).
 * @param context.roleCodes - Roles HIS activos del usuario (TenantContext.roleCodes).
 * @param context.ecePersonalRoles - Roles ece.rol opcionales para refinamiento futuro.
 */
export function hasEcePermission(
  permission: EcePermission,
  context: { roleCodes: readonly string[]; ecePersonalRoles?: string[] },
): boolean {
  const { roleCodes } = context;

  // ADMIN tiene acceso total sin excepción.
  if (hasAny(roleCodes, ADMIN_CODES)) return true;

  switch (permission) {
    case "ece.documento.firmar":
      // Médicos, enfermería y especialistas firman (cada uno su tipo de documento).
      return (
        hasAny(roleCodes, PHYSICIAN_CODES) ||
        hasAny(roleCodes, NURSE_CODES) ||
        hasAny(roleCodes, ESP_CODES)
      );

    case "ece.documento.validar":
      // Solo médicos validan (segunda revisión antes de certificar).
      return hasAny(roleCodes, PHYSICIAN_CODES);

    case "ece.documento.certificar":
      // Solo DIR certifica copias formales (Art. 21 NTEC).
      return hasAny(roleCodes, DIR_CODES);

    case "ece.documento.anular":
      // Solo DIR puede anular documentos certificados.
      return hasAny(roleCodes, DIR_CODES);

    case "ece.bitacora.read":
      // DIR y Archivo Clínico (ARCH) consultan la bitácora (Arts. 45-52 NTEC).
      return hasAny(roleCodes, DIR_CODES) || hasAny(roleCodes, ARCH_CODES);

    case "ece.rectificacion.solicitar":
      // Médicos y enfermería solicitan rectificaciones (Art. 41 NTEC).
      return hasAny(roleCodes, PHYSICIAN_CODES) || hasAny(roleCodes, NURSE_CODES);

    case "ece.rectificacion.aprobar":
      // Solo DIR aprueba rectificaciones.
      return hasAny(roleCodes, DIR_CODES);

    case "ece.workflow.designer":
      // Solo DIR diseña workflows ECE.
      return hasAny(roleCodes, DIR_CODES);

    default: {
      // Garantiza exhaustividad en tiempo de compilación.
      const _exhaustive: never = permission;
      return false;
    }
  }
}
