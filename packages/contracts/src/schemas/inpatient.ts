/**
 * §11 Inpatient (Hospitalización) — schemas de input.
 *
 * Beta.1 hardening (2026-05-13):
 * - State machine validada (ACTIVE → ON_LEAVE → ACTIVE → DISCHARGED|TRANSFERRED_OUT).
 * - Vital signs thresholds para auto-alertas.
 * - Auto-link de cama al admit (bedId opcional).
 * - Inputs explícitos para ON_LEAVE / RETURN_FROM_LEAVE / TRANSFER_OUT.
 *
 * Reglas de transición y validaciones de LOS exhaustivas viven en el router;
 * aquí se valida la forma del contrato y se exportan helpers puros.
 */
import { z } from "zod";

const INPATIENT_STATUS = [
  // ISSS MNP-S-138 Hitos 1-3 (docs/36_admision_vs_ingreso_isss.md)
  "ADMISSION_DECIDED",   // Hito 1: médico indicó ingreso, sin cama
  "BED_ASSIGNED",        // Hito 2: cama reservada, sin recibir paciente
  "ACTIVE",              // Hito 3: paciente físicamente en sala (inicia día-cama)
  "ON_LEAVE",            // permiso pase domiciliario
  "DISCHARGE_PENDING",   // alta firmada, esperando salida administrativa
  "CANCELLED",           // admisión revertida pre-recepción física
  "DISCHARGED",          // alta efectiva (terminal)
  "TRANSFERRED_OUT",     // transferido a otra org (terminal)
] as const;

const CARE_PLAN_STATUS = [
  "DRAFT",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
] as const;

const KARDEX_CATEGORY = [
  "DIET",
  "ACTIVITY",
  "OBSERVATION",
  "PROCEDURE",
  "NURSING",
  "OTHER",
] as const;

const KARDEX_SHIFT = ["MORNING", "AFTERNOON", "NIGHT"] as const;

export const inpatientStatusEnum = z.enum(INPATIENT_STATUS);
export const carePlanStatusEnum = z.enum(CARE_PLAN_STATUS);
export const kardexCategoryEnum = z.enum(KARDEX_CATEGORY);
export const kardexShiftEnum = z.enum(KARDEX_SHIFT);

export type InpatientStatusType = z.infer<typeof inpatientStatusEnum>;
export type CarePlanStatusType = z.infer<typeof carePlanStatusEnum>;

// ---------------------------------------------------------------------------
// Beta.1 hardening — state machine
// ---------------------------------------------------------------------------

/**
 * Reglas de transición de estado para InpatientAdmission.
 * Documentadas conforme TDR §11.5 (estados de hospitalización).
 */
const STATE_TRANSITIONS: Record<InpatientStatusType, ReadonlyArray<InpatientStatusType>> = {
  // ISSS MNP-S-138 — 3 hitos del ciclo hospitalario (docs/36_admision_vs_ingreso_isss.md)
  ADMISSION_DECIDED: ["BED_ASSIGNED", "CANCELLED"],
  BED_ASSIGNED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["ON_LEAVE", "DISCHARGE_PENDING", "DISCHARGED", "TRANSFERRED_OUT"],
  DISCHARGE_PENDING: ["DISCHARGED", "ACTIVE"], // reversible si se desbloquea el alta
  ON_LEAVE: ["ACTIVE", "DISCHARGED"],
  CANCELLED: [], // terminal (admisión revertida pre-recepción física)
  DISCHARGED: [], // terminal
  TRANSFERRED_OUT: [], // terminal
};

/** Pure helper — true si la transición está permitida. */
export function canTransitionInpatient(
  from: InpatientStatusType,
  to: InpatientStatusType,
): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

/** Lista de estados terminales (no admiten más cambios). */
export function isTerminalInpatientStatus(status: InpatientStatusType): boolean {
  return STATE_TRANSITIONS[status].length === 0;
}

// ---------------------------------------------------------------------------
// Beta.1 hardening — vital signs thresholds para auto-alertas
// ---------------------------------------------------------------------------

/**
 * Umbrales clínicos genéricos adulto para detección automática de alertas
 * (TDR §11.2 referencia Manchester / NEWS2 adaptado Wave 1).
 *
 * Pediatría tiene umbrales distintos — Wave 2 introducirá `ageGroupId` para
 * sub-clasificar (neonato, lactante, escolar, adolescente, adulto, geriátrico).
 */
export const VITAL_THRESHOLDS_ADULT = {
  temperatureC: { criticalLow: 35.0, criticalHigh: 39.5, warnLow: 36.0, warnHigh: 38.5 },
  heartRate: { criticalLow: 40, criticalHigh: 130, warnLow: 50, warnHigh: 110 },
  respiratoryRate: { criticalLow: 8, criticalHigh: 30, warnLow: 12, warnHigh: 24 },
  systolicBp: { criticalLow: 80, criticalHigh: 200, warnLow: 90, warnHigh: 180 },
  diastolicBp: { criticalLow: 50, criticalHigh: 120, warnLow: 60, warnHigh: 110 },
  spo2: { criticalLow: 88, criticalHigh: 100, warnLow: 92, warnHigh: 100 },
  painScale: { criticalLow: 0, criticalHigh: 10, warnLow: 0, warnHigh: 7 },
} as const;

export type InpatientVitalAlertSeverity = "info" | "warn" | "critical";
export interface InpatientVitalAlert {
  field: string;
  value: number;
  severity: InpatientVitalAlertSeverity;
  threshold: number;
  reason: string;
}

/** Pure helper — evalúa signos vitales y produce lista de alertas. */
export function evaluateVitalAlerts(input: {
  temperatureC?: number | null;
  heartRate?: number | null;
  respiratoryRate?: number | null;
  systolicBp?: number | null;
  diastolicBp?: number | null;
  spo2?: number | null;
  painScale?: number | null;
}): InpatientVitalAlert[] {
  const alerts: InpatientVitalAlert[] = [];
  const t = VITAL_THRESHOLDS_ADULT;

  function check(
    field: keyof typeof t,
    value: number | null | undefined,
  ): void {
    if (value === null || value === undefined) return;
    const limits = t[field];
    if (value <= limits.criticalLow) {
      alerts.push({
        field,
        value,
        severity: "critical",
        threshold: limits.criticalLow,
        reason: `${field} ≤ ${limits.criticalLow}`,
      });
    } else if (value >= limits.criticalHigh) {
      alerts.push({
        field,
        value,
        severity: "critical",
        threshold: limits.criticalHigh,
        reason: `${field} ≥ ${limits.criticalHigh}`,
      });
    } else if (value <= limits.warnLow) {
      alerts.push({
        field,
        value,
        severity: "warn",
        threshold: limits.warnLow,
        reason: `${field} ≤ ${limits.warnLow}`,
      });
    } else if (value >= limits.warnHigh) {
      alerts.push({
        field,
        value,
        severity: "warn",
        threshold: limits.warnHigh,
        reason: `${field} ≥ ${limits.warnHigh}`,
      });
    }
  }

  check("temperatureC", input.temperatureC);
  check("heartRate", input.heartRate);
  check("respiratoryRate", input.respiratoryRate);
  check("systolicBp", input.systolicBp);
  check("diastolicBp", input.diastolicBp);
  check("spo2", input.spo2);
  check("painScale", input.painScale);

  return alerts;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const inpatientAdmissionCreateInput = z.object({
  encounterId: z.string().uuid(),
  establishmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  attendingId: z.string().uuid(),
  reason: z.string().trim().min(1).max(400),
  expectedLos: z.number().int().min(1).max(365).optional(),
  notes: z.string().trim().max(4000).optional(),
  /** Beta.1 hardening — auto-link de cama al admitir. */
  bedId: z.string().uuid().optional(),
  /** Razón al asignar cama (auditoría). */
  bedAssignmentReason: z.string().trim().max(200).optional(),
  /** Centro de costo productivo donde se imputa la hospitalización. */
  costCenterId: z.string().uuid().optional(),
});

export const inpatientAdmissionListInput = z.object({
  status: inpatientStatusEnum.optional(),
  patientId: z.string().uuid().optional(),
  attendingId: z.string().uuid().optional(),
  establishmentId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const inpatientAdmissionDischargeInput = z.object({
  id: z.string().uuid(),
  notes: z.string().trim().max(4000).optional(),
});

/** Beta.1 — transición ACTIVE → ON_LEAVE (permiso pase domiciliario). */
export const inpatientAdmissionGoOnLeaveInput = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(400),
});

/** Beta.1 — transición ON_LEAVE → ACTIVE. */
export const inpatientAdmissionReturnFromLeaveInput = z.object({
  id: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
});

/** Beta.1 — transición ACTIVE → TRANSFERRED_OUT (transferencia a otra organización). */
export const inpatientAdmissionTransferOutInput = z.object({
  id: z.string().uuid(),
  destinationName: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(400),
  notes: z.string().trim().max(4000).optional(),
});

export const inpatientVitalsRecordInput = z.object({
  admissionId: z.string().uuid(),
  temperatureC: z.number().min(25).max(45).optional(),
  heartRate: z.number().int().min(20).max(250).optional(),
  respiratoryRate: z.number().int().min(4).max(80).optional(),
  systolicBp: z.number().int().min(40).max(260).optional(),
  diastolicBp: z.number().int().min(20).max(180).optional(),
  spo2: z.number().int().min(40).max(100).optional(),
  painScale: z.number().int().min(0).max(10).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const inpatientKardexCreateInput = z.object({
  admissionId: z.string().uuid(),
  category: kardexCategoryEnum,
  entry: z.string().trim().min(1).max(4000),
  shift: kardexShiftEnum.optional(),
});

export const inpatientCarePlanCreateInput = z.object({
  admissionId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  goal: z.string().trim().max(2000).optional(),
  interventions: z.string().trim().max(4000).optional(),
});

export const inpatientCarePlanUpdateStatusInput = z.object({
  id: z.string().uuid(),
  status: carePlanStatusEnum,
});

// ---------------------------------------------------------------------------
// ISSS MNP-S-138 — los 3 hitos del ciclo hospitalario
// Spec: docs/36_admision_vs_ingreso_isss.md
// ---------------------------------------------------------------------------

/** Hito 1 — Admisión (decisión clínica). Médico indica el ingreso. */
export const inpatientDecidirAdmisionInput = z.object({
  encounterId: z.string().uuid(),
  establishmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  attendingId: z.string().uuid(),
  reason: z.string().trim().min(1).max(400),
  expectedLos: z.number().int().min(1).max(365).optional(),
  notes: z.string().trim().max(4000).optional(),
  costCenterId: z.string().uuid().optional(),
});

/** Hito 2 — Asignación de cama (reserva operativa). */
export const inpatientAsignarCamaInput = z.object({
  id: z.string().uuid(), // InpatientAdmission.id
  bedId: z.string().uuid(),
  reason: z.string().trim().max(400).optional(),
});

/** Hito 3 — Recepción física en sala (INICIA DÍA-CAMA, Norma General 6 ISSS). */
export const inpatientConfirmarRecepcionFisicaInput = z.object({
  id: z.string().uuid(), // InpatientAdmission.id
  admissionFormNumber: z.string().trim().max(40).optional(), // SAFISSS 130201132
  wristbandPlaced: z.boolean().default(true),
  notes: z.string().trim().max(2000).optional(),
});

/** Cancelación pre-cama: ADMISSION_DECIDED → CANCELLED (decisión revertida). */
export const inpatientCancelarPreCamaInput = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(400),
});

export type InpatientDecidirAdmisionInput = z.infer<typeof inpatientDecidirAdmisionInput>;
export type InpatientAsignarCamaInput = z.infer<typeof inpatientAsignarCamaInput>;
export type InpatientConfirmarRecepcionFisicaInput = z.infer<typeof inpatientConfirmarRecepcionFisicaInput>;
export type InpatientCancelarPreCamaInput = z.infer<typeof inpatientCancelarPreCamaInput>;

export type InpatientAdmissionCreateInput = z.infer<typeof inpatientAdmissionCreateInput>;
export type InpatientAdmissionListInput = z.infer<typeof inpatientAdmissionListInput>;
export type InpatientAdmissionDischargeInput = z.infer<typeof inpatientAdmissionDischargeInput>;
export type InpatientAdmissionGoOnLeaveInput = z.infer<typeof inpatientAdmissionGoOnLeaveInput>;
export type InpatientAdmissionReturnFromLeaveInput = z.infer<typeof inpatientAdmissionReturnFromLeaveInput>;
export type InpatientAdmissionTransferOutInput = z.infer<typeof inpatientAdmissionTransferOutInput>;
export type InpatientVitalsRecordInput = z.infer<typeof inpatientVitalsRecordInput>;
export type InpatientKardexCreateInput = z.infer<typeof inpatientKardexCreateInput>;
export type InpatientCarePlanCreateInput = z.infer<typeof inpatientCarePlanCreateInput>;
export type InpatientCarePlanUpdateStatusInput = z.infer<typeof inpatientCarePlanUpdateStatusInput>;
