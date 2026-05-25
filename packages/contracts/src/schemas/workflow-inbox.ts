/**
 * Workflow Inbox — Bandeja centralizada de tareas pendientes por rol.
 *
 * Patrón BPM: cada "tarea" representa una acción pendiente en un flujo de
 * negocio que requiere intervención humana (firma, validación, dispensación,
 * reporte, certificación, etc.). El sistema agrega tareas de múltiples
 * fuentes (Prescription, LabOrder, ImagingOrder, TriageEvaluation,
 * Documento ECE, Rectificación, etc.) en un shape unificado.
 *
 * Routing RBAC: cada tipo de tarea declara los `requiredRoles`. El procedure
 * `miBandeja` filtra por intersección con `ctx.tenant.roleCodes`. Esto
 * implementa "asignación de tareas basada en roles" sin romper las acciones
 * independientes que ya existen en el menú lateral (la bandeja es un
 * shortcut centralizado, no el único punto de entrada).
 *
 * NO se exporta desde `schemas/index.ts` (import directo desde el router).
 */
import { z } from "zod";

/** Tipo de tarea — corresponde a una transición BPM esperada. */
export const taskTypeEnum = z.enum([
  "PRESCRIPTION_TO_SIGN",         // Receta DRAFT pendiente de firma médica (MC)
  "PRESCRIPTION_TO_DISPENSE",     // Receta SIGNED lista para dispensar (PHARM)
  "TRIAGE_IN_PROGRESS",           // Triage IN_PROGRESS pendiente de completar (TRIAGIST/NURSE)
  "LAB_TO_PROCESS",               // LabOrder ORDERED/COLLECTED para procesar (LAB_TECH)
  "LAB_TO_VALIDATE",              // LabOrder RESULTED para validar (LAB_VALIDATOR/MC)
  "IMAGING_TO_REPORT",            // ImagingOrder COMPLETED para reportar (RAD)
  "IMAGING_TO_VALIDATE",          // ImagingOrder REPORTED para validar (MC/RAD)
  "ECE_RECTIFICACION_PENDING",    // Rectificación ECE pendiente de aprobación (DIR)
  "ECE_DOC_TO_CERTIFY",           // Documento ECE pendiente de certificación DIR
  "MED_TO_ADMINISTER",            // Medicación bedside pendiente de administrar (NURSE)
]);
export type TaskType = z.infer<typeof taskTypeEnum>;

/** Severidad / prioridad de la tarea. */
export const taskPriorityEnum = z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]);
export type TaskPriority = z.infer<typeof taskPriorityEnum>;

/** SLA por tipo de tarea en minutos. Null = sin SLA. */
export const TASK_SLA_MINUTES: Record<TaskType, number | null> = {
  PRESCRIPTION_TO_SIGN:      30,
  PRESCRIPTION_TO_DISPENSE:  60,
  TRIAGE_IN_PROGRESS:        10,
  LAB_TO_PROCESS:           120,
  LAB_TO_VALIDATE:           60,
  IMAGING_TO_REPORT:        240,
  IMAGING_TO_VALIDATE:       60,
  ECE_RECTIFICACION_PENDING: 1440, // 24h
  ECE_DOC_TO_CERTIFY:        480,  // 8h
  MED_TO_ADMINISTER:         15,
};

/** Roles RBAC que pueden ejecutar cada tipo de tarea. */
export const TASK_REQUIRED_ROLES: Record<TaskType, string[]> = {
  PRESCRIPTION_TO_SIGN:      ["MC", "PHYSICIAN"],
  PRESCRIPTION_TO_DISPENSE:  ["PHARM", "PHARMACIST"],
  TRIAGE_IN_PROGRESS:        ["TRIAGIST", "NURSE", "ENF"],
  LAB_TO_PROCESS:            ["LAB_TECH", "LAB"],
  LAB_TO_VALIDATE:           ["LAB_VALIDATOR", "MC", "PHYSICIAN"],
  IMAGING_TO_REPORT:         ["RAD", "RADIOLOGO"],
  IMAGING_TO_VALIDATE:       ["MC", "PHYSICIAN", "RAD"],
  ECE_RECTIFICACION_PENDING: ["DIR"],
  ECE_DOC_TO_CERTIFY:        ["DIR"],
  MED_TO_ADMINISTER:         ["NURSE", "ENF"],
};

/** Label legible en español por tipo. */
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  PRESCRIPTION_TO_SIGN:      "Firmar receta",
  PRESCRIPTION_TO_DISPENSE:  "Dispensar medicación",
  TRIAGE_IN_PROGRESS:        "Completar triage",
  LAB_TO_PROCESS:            "Procesar muestra de laboratorio",
  LAB_TO_VALIDATE:           "Validar resultado de laboratorio",
  IMAGING_TO_REPORT:         "Reportar estudio de imagen",
  IMAGING_TO_VALIDATE:       "Validar reporte de imagen",
  ECE_RECTIFICACION_PENDING: "Aprobar rectificación ECE",
  ECE_DOC_TO_CERTIFY:        "Certificar documento ECE",
  MED_TO_ADMINISTER:         "Administrar medicamento bedside",
};

export const taskSchema = z.object({
  /** ID compuesto: `<type>:<sourceId>` para deduplicación cross-source. */
  id: z.string(),
  type: taskTypeEnum,
  typeLabel: z.string(),
  priority: taskPriorityEnum,
  patientName: z.string().nullable(),
  patientMrn: z.string().nullable(),
  /** Resumen corto para mostrar en la tarjeta (ej. "Ibuprofeno 400mg x10"). */
  description: z.string(),
  /** Cuándo se creó la tarea (entró al estado pendiente). */
  createdAt: z.date(),
  /** Minutos transcurridos desde createdAt. Server-side. */
  ageMinutes: z.number(),
  /** Minutos hasta el deadline. Negativo = excedido. Null = sin SLA. */
  remainingMinutes: z.number().nullable(),
  isOverdue: z.boolean(),
  /** Ruta para drill-down al formulario específico de la tarea. */
  deepLink: z.string(),
  /** Roles requeridos para ejecutar (informativo en UI). */
  requiredRoles: z.array(z.string()),
});
export type Task = z.infer<typeof taskSchema>;

export const inboxResponseSchema = z.object({
  serverNow: z.date(),
  totalTasks: z.number().int().nonnegative(),
  overdueTasks: z.number().int().nonnegative(),
  /** Counts por tipo — para badges y filtros en UI. */
  countsByType: z.array(
    z.object({
      type: taskTypeEnum,
      typeLabel: z.string(),
      count: z.number().int().nonnegative(),
      overdueCount: z.number().int().nonnegative(),
    }),
  ),
  tasks: z.array(taskSchema),
});
export type InboxResponse = z.infer<typeof inboxResponseSchema>;

export const inboxFiltersSchema = z.object({
  types: z.array(taskTypeEnum).optional(),
  onlyOverdue: z.boolean().default(false),
  priority: taskPriorityEnum.optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
export type InboxFilters = z.infer<typeof inboxFiltersSchema>;
