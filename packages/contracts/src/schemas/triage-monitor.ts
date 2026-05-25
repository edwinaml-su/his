/**
 * Wallboard de monitoreo de triage — pantalla operativa para emergencias.
 *
 * Distinto del `triage-dashboard` (whiteboard tradicional con cola de items):
 * el wallboard organiza pacientes en **5 columnas Kanban** (RED/ORANGE/YELLOW/
 * GREEN/BLUE) y agrega:
 *   - Identificación visual por sexo biológico (♀ magenta / ♂ cian).
 *   - Paso del proceso clínico actual del paciente (en triage, espera consulta,
 *     pendiente lab, pendiente imagen, admitido, etc.).
 *   - Tiempo en el paso actual (para detectar bloqueos en flujo).
 *
 * Optimizado para visualización en TV/monitor de pared con auto-refresh 5s.
 *
 * NO se exporta desde `schemas/index.ts` (mismo patrón que `triage-dashboard.ts`).
 * El router consume estas schemas vía import directo.
 */
import { z } from "zod";
import { triageColorEnum } from "./triage";
import { triageTimerSeverityEnum } from "./triage-dashboard";

/**
 * Códigos canónicos de "paso del proceso" en emergencias.
 * Derivados server-side de los registros vinculados al paciente/encuentro.
 */
export const processStepKeyEnum = z.enum([
  "TRIAGE",            // TriageEvaluation IN_PROGRESS
  "WAITING_DOCTOR",    // Triage completado, sin actividad clínica posterior
  "IN_CONSULTATION",   // EhrNote / consulta médica activa
  "PENDING_LAB",       // LabOrder.status IN (ORDERED, IN_PROGRESS)
  "PENDING_IMAGING",   // ImagingOrder.status IN (ORDERED, SCHEDULED, IN_PROGRESS)
  "PENDING_ADMISSION", // Encounter con admissionType pendiente o derivación
  "ADMITTED",          // InpatientAdmission activa (no dada de alta)
  "DISCHARGE_READY",   // Encounter con dischargedAt seteado en próximas horas
  "UNKNOWN",           // No se pudo derivar
]);
export type ProcessStepKey = z.infer<typeof processStepKeyEnum>;

/** Sexo biológico — mapping a códigos del catálogo BiologicalSex.code. */
export const sexCodeEnum = z.enum(["M", "F", "I", "U"]);
export type SexCode = z.infer<typeof sexCodeEnum>;

export const triageMonitorItemSchema = z.object({
  id: z.string().uuid(), // TriageEvaluation.id
  patient: z.object({
    id: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    mrn: z.string(),
    ageYears: z.number().int().nonnegative().nullable(),
    sexCode: sexCodeEnum.nullable(),
    isUnknown: z.boolean(),
  }),
  encounterId: z.string().uuid().nullable(),
  assignedLevel: z.object({
    color: triageColorEnum,
    name: z.string(),
    priority: z.number().int().min(1).max(5),
    maxWaitMinutes: z.number().int().positive(),
    uiColorHex: z.string().nullable(),
  }),
  startedAt: z.date(),
  elapsedMinutes: z.number(),
  remainingMinutes: z.number(),
  isOverdue: z.boolean(),
  severity: triageTimerSeverityEnum,
  /** Paso del proceso actual + tiempo de permanencia. */
  processStep: processStepKeyEnum,
  /** Label legible derivado de processStep. */
  processStepLabel: z.string(),
});

export type TriageMonitorItem = z.infer<typeof triageMonitorItemSchema>;

export const triageMonitorLevelSchema = z.object({
  color: triageColorEnum,
  name: z.string(),
  uiColorHex: z.string().nullable(),
  maxWaitMinutes: z.number().int().positive(),
  count: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  items: z.array(triageMonitorItemSchema),
});

export const triageMonitorResponseSchema = z.object({
  serverNow: z.date(),
  totalActive: z.number().int().nonnegative(),
  totalOverdue: z.number().int().nonnegative(),
  /** 5 columnas ordenadas por priority asc (RED primero). */
  levels: z.array(triageMonitorLevelSchema),
});

export type TriageMonitorResponse = z.infer<typeof triageMonitorResponseSchema>;

/** Mapping ProcessStep → label en español. */
export const PROCESS_STEP_LABEL: Record<ProcessStepKey, string> = {
  TRIAGE: "En triage",
  WAITING_DOCTOR: "Espera consulta",
  IN_CONSULTATION: "En consulta",
  PENDING_LAB: "Pendiente laboratorio",
  PENDING_IMAGING: "Pendiente imagen",
  PENDING_ADMISSION: "Pendiente admisión",
  ADMITTED: "Admitido",
  DISCHARGE_READY: "Alta próxima",
  UNKNOWN: "Sin estado",
};
