/**
 * CC-0031 Fase 0 — catálogo canónico de roles + alias, usado para:
 *   1. Verificar (test) que toda entrada de `TASK_REQUIRED_ROLES`
 *      (`workflow-inbox.ts`) resuelve a ≥1 rol real vía alias — espejo en
 *      TS del contenido sembrado por `packages/database/sql/238_*.sql`.
 *   2. La matriz de escalamiento por rol (`ESCALATION_ROLE_BY_ASSIGNED_ROLE`)
 *      que usa el watchdog SLA (`task.sla_exceeded`) y
 *      `workflowInbox.escalar` (`task.escalated`).
 *
 * MANTENER EN PARIDAD con `packages/database/sql/238_cc0031_roles_notificaciones.sql`
 * — si agregas un rol o alias en un lado, agrégalo en el otro (mismo patrón
 * de paridad TS↔SQL que `validators/index.ts` ↔ `03_validations_sv.sql`).
 */

/**
 * Roles reales en `public."Role"` ANTES de CC-0031 (14 filas verificadas en
 * prod 2026-09-15, ver docs/audit/2026-09-15_cobertura/00-inventario-infra-notificaciones.md §5.1).
 */
export const PRE_EXISTING_ROLE_CODES = [
  "ADMIN",
  "ADMISSION_CLERK",
  "ANEST",
  "DIR",
  "ENF_NRP",
  "GO",
  "NURSE",
  "PEDIA",
  "PHARMACIST",
  "PHYSICIAN",
  "TRIAGE_NURSE",
  "WORKFLOW_DESIGNER",
] as const;

/**
 * Roles NUEVOS creados por `sql/238` (idempotente, `ON CONFLICT DO NOTHING`,
 * uno por organización activa) — cierran huecos donde NINGÚN código de
 * `TASK_REQUIRED_ROLES` para ese tipo de tarea era resoluble (p.ej.
 * `GS1_TRANSFER_PENDING: ["BODEGA"]`).
 */
export const CC0031_NEW_ROLE_CODES = [
  "LAB_TECHNICIAN",
  "RAD_TECHNICIAN",
  "FACTURACION",
  "CALIDAD",
  "BODEGA",
  "GERENTE",
  "ADMIN_CLINICO",
] as const;

/** Unión de todo código que resuelve a un `Role` REAL (sin pasar por alias). */
export const REAL_ROLE_CODES: readonly string[] = [
  ...PRE_EXISTING_ROLE_CODES,
  ...CC0031_NEW_ROLE_CODES,
];

/**
 * Alias GLOBALES ya sembrados por `sql/194_cc0017_rbac_parametrizable.sql`
 * (organizationId NULL) — no se re-declaran en `sql/238`, solo se listan
 * aquí para que el test de cobertura vea el catálogo completo.
 */
export const PRE_EXISTING_ROLE_ALIASES: Readonly<Record<string, string>> = {
  MEDICO: "PHYSICIAN",
  MC: "PHYSICIAN",
  ENF: "NURSE",
  FARM: "PHARMACIST",
  ANES: "ANEST",
  SUPER_ADMIN: "super_admin",
};

/**
 * Alias NUEVOS sembrados por `sql/238` (globales, `organizationId` NULL).
 * Criterio de mapeo documentado inline — "con criterio" para los códigos sin
 * correspondencia 1:1 obvia (p.ej. `BB` banco de sangre → `LAB_TECHNICIAN`,
 * `OBSTETRA` → `GO`, `NEONATOLOGO` → `PEDIA`).
 */
export const CC0031_NEW_ROLE_ALIASES: Readonly<Record<string, string>> = {
  // Explícitos en el encargo CC-0031.
  PHARM: "PHARMACIST",
  TRIAGIST: "TRIAGE_NURSE",
  TRIAGE: "TRIAGE_NURSE",
  ADM: "ADMISSION_CLERK",
  ADMISION: "ADMISSION_CLERK",
  ANESTH: "ANEST",
  LAB_TECH: "LAB_TECHNICIAN",
  LAB: "LAB_TECHNICIAN",
  RAD: "RAD_TECHNICIAN",
  RADIOLOGO: "RAD_TECHNICIAN",
  // Resto del catálogo huérfano (00 §5.1), mapeado con criterio clínico/operativo:
  LAB_VALIDATOR: "PHYSICIAN", // validación de resultado exige firma médica.
  RECEPCION: "ADMISSION_CLERK", // recepción de pacientes = mismo dominio que admisión.
  RESP: "NURSE", // terapia respiratoria sin rol dedicado → equipo de enfermería.
  TERAPISTA: "NURSE",
  NUTRI: "PHYSICIAN", // orden nutricional requiere aprobación médica.
  OBSTETRA: "GO", // Ginecólogo-Obstetra ya existe (sql/75).
  NEONATOLOGO: "PEDIA", // Pediatra cubre neonatología (sql/75).
  BB: "LAB_TECHNICIAN", // banco de sangre operativamente parte de laboratorio.
  DPO: "ADMIN", // oficial de protección de datos → gobernanza/admin.
  FARMACO: "PHARMACIST", // farmacovigilancia → farmacia.
  MANTENIMIENTO: "ADMIN", // sin rol de facilities dedicado → admin.
  BIOMEDICA: "ADMIN",
  LIMPIEZA: "ADMIN", // idem — housekeeping sin rol dedicado.
};

/** Mapa de alias completo (fuente única para el test + para documentación). */
export const ALL_ROLE_ALIASES: Readonly<Record<string, string>> = {
  ...PRE_EXISTING_ROLE_ALIASES,
  ...CC0031_NEW_ROLE_ALIASES,
};

/**
 * Resuelve un código de rol (posiblemente alias) a un código REAL. `null` si
 * ni el código ni su alias resuelven a un `Role` conocido — espejo simplificado
 * (sin herencia, sin BD) de `getEffectiveRoleCodes` (`rbac/effective-roles.ts`),
 * usado por el test de cobertura de `TASK_REQUIRED_ROLES` y por el resolver
 * genérico como fallback estático si la BD no tiene el alias todavía.
 */
export function resolveCanonicalRoleCode(code: string): string | null {
  if (REAL_ROLE_CODES.includes(code)) return code;
  const canonical = ALL_ROLE_ALIASES[code];
  if (canonical && REAL_ROLE_CODES.includes(canonical)) return canonical;
  return null;
}

/**
 * Matriz de escalamiento CC-0031 Fase 3 — a qué rol se notifica
 * `task.sla_exceeded` / `task.escalated` cuando la tarea vencida estaba
 * asignada al rol de la clave. `DEFAULT_ESCALATION_ROLE` cubre cualquier rol
 * no listado explícitamente.
 */
export const ESCALATION_ROLE_BY_ASSIGNED_ROLE: Readonly<Record<string, string>> = {
  NURSE: "ADMIN_CLINICO",
  ENF_NRP: "ADMIN_CLINICO",
  TRIAGE_NURSE: "ADMIN_CLINICO",
  PHYSICIAN: "DIR",
  ANEST: "DIR",
  GO: "DIR",
  PEDIA: "DIR",
  LAB_TECHNICIAN: "PHYSICIAN",
  RAD_TECHNICIAN: "PHYSICIAN",
  FACTURACION: "GERENTE",
  PHARMACIST: "DIR",
  BODEGA: "GERENTE",
  ADMISSION_CLERK: "GERENTE",
};

export const DEFAULT_ESCALATION_ROLE = "DIR";

/** Resuelve el rol de escalamiento para un `assignedRoleCode` (post-alias). */
export function resolveEscalationRole(assignedRoleCode: string): string {
  const canonical = resolveCanonicalRoleCode(assignedRoleCode) ?? assignedRoleCode;
  return ESCALATION_ROLE_BY_ASSIGNED_ROLE[canonical] ?? DEFAULT_ESCALATION_ROLE;
}
