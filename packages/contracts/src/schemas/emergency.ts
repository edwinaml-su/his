/**
 * §12 Emergency (Urgencias) — schemas + helpers de business rules.
 *
 * Beta.4 hardening (2026-05-13):
 * - State machine `canTransitionEmergencyDisposition` con terminales
 *   DISCHARGED, ADMITTED, TRANSFERRED, LWBS, AMA, DECEASED.
 * - Helper `detectLwbsCandidate` — paciente pendiente más de N minutos sin
 *   doctor asignado. Wave 1: timeout configurable por organización
 *   (default 240 min = 4h conforme brief @Orq).
 * - Helper `computeObservationDuration` — duración acumulada de observación
 *   (consume `observationStartedAt`/`observationEndedAt`).
 * - Helper `shouldTriggerRetriage` — compara vitales nuevos vs previos y
 *   evalúa si el deterioro amerita re-triage (link a TriageRetriage).
 *
 * Reglas LWBS automation programada (cron) viven en infraestructura;
 * aquí solo el cálculo puro determinístico.
 */
import { z } from "zod";

const DISPOSITION = [
  "PENDING",
  "DISCHARGED",
  "ADMITTED",
  "TRANSFERRED",
  "LWBS",
  "AMA",
  "DECEASED",
] as const;

const ARRIVAL_MODE = [
  "WALK_IN",
  "AMBULANCE",
  "POLICE",
  "REFERRAL",
  "PRIVATE_VEHICLE",
  "OTHER",
] as const;

const EMERGENCY_NOTE_CATEGORY = [
  "OBSERVATION",
  "TREATMENT",
  "REASSESSMENT",
] as const;

export const emergencyDispositionEnum = z.enum(DISPOSITION);
export const emergencyArrivalModeEnum = z.enum(ARRIVAL_MODE);
export const emergencyNoteCategoryEnum = z.enum(EMERGENCY_NOTE_CATEGORY);

export type EmergencyDispositionType = z.infer<typeof emergencyDispositionEnum>;
export type EmergencyArrivalModeType = z.infer<typeof emergencyArrivalModeEnum>;

export const emergencyVisitCreateInput = z.object({
  encounterId: z.string().uuid(),
  establishmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  chiefComplaint: z.string().trim().min(1).max(400),
  arrivalMode: emergencyArrivalModeEnum.default("WALK_IN"),
  treatingId: z.string().uuid().optional(),
});

export const emergencyVisitListInput = z.object({
  disposition: emergencyDispositionEnum.optional(),
  patientId: z.string().uuid().optional(),
  treatingId: z.string().uuid().optional(),
  establishmentId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const emergencyVisitDispositionInput = z.object({
  id: z.string().uuid(),
  disposition: emergencyDispositionEnum,
  notes: z.string().trim().max(4000).optional(),
});

export const emergencyVisitStartObservationInput = z.object({
  id: z.string().uuid(),
});

export const emergencyVisitEndObservationInput = z.object({
  id: z.string().uuid(),
});

export const emergencyNoteCreateInput = z.object({
  visitId: z.string().uuid(),
  category: emergencyNoteCategoryEnum,
  body: z.string().trim().min(1).max(8000),
});

export type EmergencyVisitCreateInput = z.infer<typeof emergencyVisitCreateInput>;
export type EmergencyVisitListInput = z.infer<typeof emergencyVisitListInput>;
export type EmergencyVisitDispositionInput = z.infer<typeof emergencyVisitDispositionInput>;
export type EmergencyNoteCreateInput = z.infer<typeof emergencyNoteCreateInput>;

// ---------------------------------------------------------------------------
// Beta.4 hardening — state machine de disposition
// ---------------------------------------------------------------------------

/**
 * Reglas de transición de EmergencyDisposition conforme brief Beta.4.
 * PENDING admite todos los outcomes; los outcomes son terminales (no se
 * puede salir de DISCHARGED a otra cosa).
 *
 * Wave 2: si surge necesidad clínica, contemplar reapertura de visita
 * cerrada (registro de errores / re-admisión inmediata).
 */
const DISPOSITION_TRANSITIONS: Record<
  EmergencyDispositionType,
  ReadonlyArray<EmergencyDispositionType>
> = {
  PENDING: ["DISCHARGED", "ADMITTED", "TRANSFERRED", "LWBS", "AMA", "DECEASED"],
  DISCHARGED: [], // terminal
  ADMITTED: [], // terminal
  TRANSFERRED: [], // terminal
  LWBS: [], // terminal
  AMA: [], // terminal
  DECEASED: [], // terminal
};

/** Pure helper — true si la transición está permitida. */
export function canTransitionEmergencyDisposition(
  from: EmergencyDispositionType,
  to: EmergencyDispositionType,
): boolean {
  return DISPOSITION_TRANSITIONS[from].includes(to);
}

/** True si la disposition es terminal y no admite más cambios. */
export function isTerminalEmergencyDisposition(
  d: EmergencyDispositionType,
): boolean {
  return DISPOSITION_TRANSITIONS[d].length === 0;
}

// ---------------------------------------------------------------------------
// Beta.4 hardening — LWBS detection
// ---------------------------------------------------------------------------

/** Timeout default en minutos para considerar LWBS candidate (brief: 4h). */
export const LWBS_DEFAULT_TIMEOUT_MIN = 240;

export interface LwbsCandidateInput {
  /** Visita en evaluación. */
  visit: {
    disposition: EmergencyDispositionType;
    arrivedAt: Date;
    treatingId: string | null | undefined;
  };
  /** "Now" inyectado para tests determinísticos. */
  now: Date;
  /** Timeout en minutos. Si undefined, usa LWBS_DEFAULT_TIMEOUT_MIN. */
  timeoutMinutes?: number;
}

/**
 * Detecta si una visita PENDING sin treating asignado supera el timeout
 * configurable y debe marcarse como LWBS. Retorna objeto detallado para
 * facilitar logging/auditoría.
 *
 * Reglas:
 * - Solo aplica a disposition PENDING.
 * - treatingId debe ser null/undefined (sin doctor asignado).
 * - Elapsed >= timeout minutos.
 */
export function detectLwbsCandidate(input: LwbsCandidateInput): {
  isCandidate: boolean;
  elapsedMinutes: number;
  timeoutMinutes: number;
  reason: "OK" | "ALREADY_DISPOSITIONED" | "HAS_TREATING" | "WITHIN_TIMEOUT";
} {
  const timeoutMin = input.timeoutMinutes ?? LWBS_DEFAULT_TIMEOUT_MIN;
  const elapsedMs = input.now.getTime() - input.visit.arrivedAt.getTime();
  const elapsedMin = Math.floor(elapsedMs / 60_000);

  if (input.visit.disposition !== "PENDING") {
    return {
      isCandidate: false,
      elapsedMinutes: elapsedMin,
      timeoutMinutes: timeoutMin,
      reason: "ALREADY_DISPOSITIONED",
    };
  }
  if (input.visit.treatingId) {
    return {
      isCandidate: false,
      elapsedMinutes: elapsedMin,
      timeoutMinutes: timeoutMin,
      reason: "HAS_TREATING",
    };
  }
  if (elapsedMin < timeoutMin) {
    return {
      isCandidate: false,
      elapsedMinutes: elapsedMin,
      timeoutMinutes: timeoutMin,
      reason: "WITHIN_TIMEOUT",
    };
  }
  return {
    isCandidate: true,
    elapsedMinutes: elapsedMin,
    timeoutMinutes: timeoutMin,
    reason: "OK",
  };
}

// ---------------------------------------------------------------------------
// Beta.4 hardening — observation timer
// ---------------------------------------------------------------------------

/**
 * Calcula duración de la ventana de observación, tolerante a observación
 * abierta (sin endedAt). Si endedAt está presente, usa ese valor;
 * si no, usa `now`.
 *
 * Retorna 0 si no hay observación iniciada.
 */
export function computeObservationDuration(input: {
  observationStartedAt: Date | null | undefined;
  observationEndedAt: Date | null | undefined;
  now: Date;
}): {
  minutes: number;
  isOpen: boolean;
} {
  if (!input.observationStartedAt) {
    return { minutes: 0, isOpen: false };
  }
  const end = input.observationEndedAt ?? input.now;
  const ms = end.getTime() - input.observationStartedAt.getTime();
  return {
    minutes: Math.max(0, Math.floor(ms / 60_000)),
    isOpen: !input.observationEndedAt,
  };
}

// ---------------------------------------------------------------------------
// Beta.4 hardening — re-triage trigger por deterioro de vitales
// ---------------------------------------------------------------------------

export interface VitalSnapshot {
  /** Frecuencia cardíaca (lpm). */
  heartRate?: number | null;
  /** Frecuencia respiratoria (rpm). */
  respiratoryRate?: number | null;
  /** Saturación O2 (%). */
  spo2?: number | null;
  /** Presión arterial sistólica (mmHg). */
  systolicBp?: number | null;
  /** Temperatura (°C). */
  temperatureC?: number | null;
  /** Escala de dolor 0-10. */
  painScale?: number | null;
}

/**
 * Detecta si los vitales nuevos representan deterioro suficiente vs previos
 * para gatillar re-triage. Reglas clínicas básicas Wave 1 (NEWS2 simplificado):
 *
 * - SpO2 cae >= 4 puntos o llega a <= 92
 * - HR sube >= 30 lpm o llega a >= 130
 * - RR sube >= 6 rpm o llega a >= 25
 * - Sistólica cae >= 30 mmHg o llega a <= 90
 * - Pain sube >= 4 puntos en 0-10
 *
 * Si previous es null, considera solo umbrales absolutos críticos.
 * Retorna razones específicas para logging.
 */
export function shouldTriggerRetriage(input: {
  previous: VitalSnapshot | null;
  current: VitalSnapshot;
}): {
  shouldRetriage: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const { previous, current } = input;

  // SpO2
  if (current.spo2 != null) {
    if (current.spo2 <= 92) {
      reasons.push(`SpO2 absoluto bajo: ${current.spo2}%`);
    }
    if (previous?.spo2 != null && previous.spo2 - current.spo2 >= 4) {
      reasons.push(
        `SpO2 caída >= 4 puntos: ${previous.spo2}% -> ${current.spo2}%`,
      );
    }
  }

  // Heart rate
  if (current.heartRate != null) {
    if (current.heartRate >= 130) {
      reasons.push(`HR absoluto alto: ${current.heartRate} lpm`);
    }
    if (
      previous?.heartRate != null &&
      current.heartRate - previous.heartRate >= 30
    ) {
      reasons.push(
        `HR subida >= 30 lpm: ${previous.heartRate} -> ${current.heartRate}`,
      );
    }
  }

  // Respiratory rate
  if (current.respiratoryRate != null) {
    if (current.respiratoryRate >= 25) {
      reasons.push(`RR absoluto alto: ${current.respiratoryRate} rpm`);
    }
    if (
      previous?.respiratoryRate != null &&
      current.respiratoryRate - previous.respiratoryRate >= 6
    ) {
      reasons.push(
        `RR subida >= 6 rpm: ${previous.respiratoryRate} -> ${current.respiratoryRate}`,
      );
    }
  }

  // Sistólica
  if (current.systolicBp != null) {
    if (current.systolicBp <= 90) {
      reasons.push(`Sistólica absoluta baja: ${current.systolicBp} mmHg`);
    }
    if (
      previous?.systolicBp != null &&
      previous.systolicBp - current.systolicBp >= 30
    ) {
      reasons.push(
        `Sistólica caída >= 30: ${previous.systolicBp} -> ${current.systolicBp}`,
      );
    }
  }

  // Pain (solo delta significativo)
  if (
    current.painScale != null &&
    previous?.painScale != null &&
    current.painScale - previous.painScale >= 4
  ) {
    reasons.push(
      `Dolor subida >= 4: ${previous.painScale} -> ${current.painScale}`,
    );
  }

  return {
    shouldRetriage: reasons.length > 0,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Beta.4 inputs extendidos
// ---------------------------------------------------------------------------

/** Input para chequeo masivo LWBS desde cron/router. */
export const lwbsCheckInput = z.object({
  /** Override del timeout para una organización específica. */
  timeoutMinutes: z.number().int().min(15).max(720).optional(),
  /** Solo retornar visitas (no aplicar la transición). */
  dryRun: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(100),
});

export type LwbsCheckInput = z.infer<typeof lwbsCheckInput>;

/** Input para registrar vitales con detección automática de re-triage. */
export const emergencyVitalRecordInput = z.object({
  visitId: z.string().uuid(),
  heartRate: z.number().int().min(20).max(300).optional(),
  respiratoryRate: z.number().int().min(4).max(80).optional(),
  spo2: z.number().int().min(40).max(100).optional(),
  systolicBp: z.number().int().min(40).max(260).optional(),
  diastolicBp: z.number().int().min(20).max(180).optional(),
  temperatureC: z.number().min(28).max(45).optional(),
  painScale: z.number().int().min(0).max(10).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type EmergencyVitalRecordInput = z.infer<typeof emergencyVitalRecordInput>;
