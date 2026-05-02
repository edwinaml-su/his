/**
 * US-2.4 — ABAC helpers (MVP).
 *
 * Reglas DECLARATIVAS hardcoded para el MVP. NO bloquean tRPC todavía; se
 * exponen para que la UI consulte (`/abac`) y para que las pantallas que ya
 * conocen al usuario y al recurso oculten/desactiven controles.
 *
 * TODO Sprint 2:
 *  - Persistir las reglas en tabla `AbacRule` (engine de evaluación dinámico).
 *  - Middleware tRPC `abacGuard(action, resourceKind)` que invoque estos
 *    helpers antes de cada procedure sensible.
 *  - Atributo de "asignación a ServiceUnit" en User (hoy se asume true en org).
 *
 * Convención de role codes:
 *   ADMIN          ≈ super_admin / admin_clinico
 *   PHYSICIAN      ≈ medico
 *   NURSE          ≈ enfermeria
 *   TRIAGE_NURSE   ≈ triador
 *   PHARMACIST     ≈ farmaceutico (Sprint 2 catálogo de roles)
 *
 * Aceptamos ambas familias (en/es) para suavizar la transición.
 */
import type { AbacRule } from "@his/contracts";

// -----------------------------------------------------------------------------
// Tipos mínimos (subset de los modelos Prisma) para no acoplar a runtime.
// -----------------------------------------------------------------------------

export interface AbacUser {
  id: string;
  organizationId: string;
  /** Códigos de roles activos del usuario en la org actual. */
  roleCodes: readonly string[];
  active?: boolean;
}

export interface AbacPatient {
  id: string;
  organizationId: string;
  /** Si tiene un encounter activo con triage en curso. */
  hasActiveTriage?: boolean;
}

// -----------------------------------------------------------------------------
// Sets de roles
// -----------------------------------------------------------------------------

const ROLE_ADMIN = new Set(["super_admin", "admin_clinico", "ADMIN"]);
const ROLE_PHYSICIAN = new Set(["medico", "PHYSICIAN"]);
const ROLE_NURSE = new Set(["enfermeria", "NURSE"]);
const ROLE_TRIAGE = new Set(["triador", "TRIAGE_NURSE"]);
const ROLE_PHARMACIST = new Set(["farmaceutico", "PHARMACIST"]);

function hasAny(user: AbacUser, set: Set<string>): boolean {
  return user.roleCodes.some((c) => set.has(c));
}

function isActive(user: AbacUser): boolean {
  return user.active !== false;
}

function sameOrg(user: AbacUser, patient: AbacPatient): boolean {
  return user.organizationId === patient.organizationId;
}

// -----------------------------------------------------------------------------
// Helpers públicos
// -----------------------------------------------------------------------------

/**
 * ¿Puede el usuario LEER/INTERACTUAR con este paciente?
 *
 * Reglas (en orden):
 *   1. Usuario inactivo → DENY siempre.
 *   2. ADMIN (super_admin/admin_clinico) → ALLOW (responsable de soporte).
 *   3. PHYSICIAN, NURSE → ALLOW si pertenecen a la misma org del paciente.
 *   4. TRIAGE_NURSE → ALLOW solo si paciente tiene triage activo
 *      (foco operativo en sala de espera/clasificación).
 *   5. Default DENY.
 */
export function canAccessPatient(user: AbacUser, patient: AbacPatient): boolean {
  if (!isActive(user)) return false;
  if (hasAny(user, ROLE_ADMIN)) return true;
  if ((hasAny(user, ROLE_PHYSICIAN) || hasAny(user, ROLE_NURSE)) && sameOrg(user, patient)) {
    return true;
  }
  if (hasAny(user, ROLE_TRIAGE) && sameOrg(user, patient) && patient.hasActiveTriage === true) {
    return true;
  }
  return false;
}

/**
 * ¿Puede el usuario PRESCRIBIR para este paciente?
 *
 * Reglas:
 *   - Solo PHYSICIAN. ADMIN no prescribe (TDR §6.2 separación de funciones).
 *   - Debe tener acceso de lectura primero (mismo org).
 */
export function canPrescribe(user: AbacUser, patient: AbacPatient): boolean {
  if (!isActive(user)) return false;
  if (!hasAny(user, ROLE_PHYSICIAN)) return false;
  return sameOrg(user, patient);
}

/**
 * ¿Puede el usuario DISPENSAR un fármaco a este paciente?
 *
 * Reglas:
 *   - Solo PHARMACIST. ADMIN/PHYSICIAN/NURSE no dispensan (separación TDR §6.2).
 *   - Mismo org.
 */
export function canDispense(user: AbacUser, patient: AbacPatient): boolean {
  if (!isActive(user)) return false;
  if (!hasAny(user, ROLE_PHARMACIST)) return false;
  return sameOrg(user, patient);
}

/**
 * ¿Puede el usuario acceder a una unidad de servicio?
 *
 * MVP: TRUE para cualquier usuario activo en la org. La columna de assignment
 * usuario↔ServiceUnit llega en Sprint 2 (TODO en schema). Cuando exista, esta
 * regla deberá pasar de "todos en la org" a "asignado o ADMIN".
 */
export function canAccessService(
  user: AbacUser,
  serviceUnitOrgId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _serviceUnitId: string,
): boolean {
  if (!isActive(user)) return false;
  if (user.organizationId !== serviceUnitOrgId) return false;
  // TODO Sprint 2: validar asignación específica al ServiceUnit.
  return true;
}

/**
 * ¿Puede el usuario FIRMAR electrónicamente (HCE/recetas)?
 *
 * Reglas: solo PHYSICIAN (firma asistencial). Otros tipos de firma (consent,
 * dispensación) se modelarán en Sprint 2 como acciones SIGN específicas.
 */
export function canSign(user: AbacUser, patient: AbacPatient): boolean {
  if (!isActive(user)) return false;
  if (!hasAny(user, ROLE_PHYSICIAN)) return false;
  return sameOrg(user, patient);
}

// -----------------------------------------------------------------------------
// Reglas declarativas (para la vista informativa /abac)
// -----------------------------------------------------------------------------

/**
 * Listado humano-legible de las reglas vigentes en MVP. Refleja exactamente
 * los `if` de los helpers de arriba. Mantener en sync manualmente hasta que
 * Sprint 2 mueva a engine dinámico.
 */
export const MVP_ABAC_RULES: ReadonlyArray<AbacRule> = [
  {
    id: "patient-read-admin",
    action: "READ",
    resourceKind: "Patient",
    allowedRoles: ["super_admin", "admin_clinico"],
    condition: "Sin restricción adicional (rol administrativo).",
    description: "Administradores leen cualquier paciente para soporte / reporting.",
  },
  {
    id: "patient-read-clinical",
    action: "READ",
    resourceKind: "Patient",
    allowedRoles: ["medico", "enfermeria"],
    condition: "user.organizationId == patient.organizationId",
    description: "Personal clínico accede a pacientes de su organización.",
  },
  {
    id: "patient-read-triage",
    action: "READ",
    resourceKind: "Patient",
    allowedRoles: ["triador"],
    condition:
      "user.organizationId == patient.organizationId AND patient.hasActiveTriage == true",
    description: "Triador ve solo pacientes con triage activo.",
  },
  {
    id: "patient-prescribe",
    action: "PRESCRIBE",
    resourceKind: "Prescription",
    allowedRoles: ["medico"],
    condition: "user.organizationId == patient.organizationId",
    description: "Solo médicos prescriben (separación TDR §6.2).",
  },
  {
    id: "patient-dispense",
    action: "DISPENSE",
    resourceKind: "Dispensation",
    allowedRoles: ["farmaceutico"],
    condition: "user.organizationId == patient.organizationId",
    description: "Solo farmacéuticos dispensan (separación TDR §6.2).",
  },
  {
    id: "patient-sign",
    action: "SIGN",
    resourceKind: "Patient",
    allowedRoles: ["medico"],
    condition: "user.organizationId == patient.organizationId",
    description: "Firma asistencial: solo médicos en su organización.",
  },
  {
    id: "service-access-org-mvp",
    action: "READ",
    resourceKind: "ServiceUnit",
    allowedRoles: ["super_admin", "admin_clinico", "medico", "enfermeria", "triador"],
    condition: "user.organizationId == serviceUnit.organizationId  (MVP — sin assignment)",
    description:
      "MVP: cualquier rol activo en la organización accede a sus unidades de servicio. " +
      "Sprint 2: agregar columna de asignación usuario↔ServiceUnit.",
  },
];
