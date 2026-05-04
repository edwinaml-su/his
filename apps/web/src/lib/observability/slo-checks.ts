/**
 * SLO Checks — funciones puras que dado data devuelven el SLI actual.
 *
 * En MVP los valores son MOCK (con realismo razonable). En Sprint 6 se integra:
 *   - Vercel Analytics API (latencias, throughput)
 *   - Sentry API (tasa de error 5xx, releases)
 *   - Supabase metrics endpoint (DB latency)
 *
 * Cada función devuelve un objeto `SloMeasurement` con:
 *   - `value`: SLI medido
 *   - `target`: objetivo SLO
 *   - `status`: derivado de la comparación value vs target (verde/amarillo/rojo)
 *   - `errorBudgetConsumedPct`: % de presupuesto de error consumido en la ventana
 *   - `windowDays`: ventana de medición
 */

export type SloStatus = "healthy" | "warning" | "breached";

export type SloUnit = "percentage" | "ms" | "minutes" | "hours";

export type SloMeasurement = {
  /** Identificador estable del SLO. */
  id: string;
  /** Nombre humano corto. */
  name: string;
  /** Categoría: técnica (infra) o clínica (procesos médicos). */
  category: "technical" | "clinical";
  /** Definición del SLI (qué se mide). */
  sliDefinition: string;
  /** Valor medido. */
  value: number;
  /** Objetivo SLO. */
  target: number;
  /** Si "higher" mejor (e.g. disponibilidad), si "lower" mejor (e.g. latencia). */
  direction: "higher_better" | "lower_better";
  /** Unidad de medición. */
  unit: SloUnit;
  /** Ventana de medición en días (28d rolling estándar SRE). */
  windowDays: number;
  /** % de error budget consumido (0-100). >100 significa breach. */
  errorBudgetConsumedPct: number;
  /** Estado actual del SLO. */
  status: SloStatus;
  /** Umbral del alert (cuándo paginar on-call). */
  alertThreshold: number;
  /** Fuente de los datos (mock | vercel | sentry | supabase | composite). */
  source: "mock" | "vercel" | "sentry" | "supabase" | "composite";
};

/** Deriva `status` de una medición numérica. */
function deriveStatus(
  value: number,
  target: number,
  direction: "higher_better" | "lower_better",
  warningMargin = 0.1,
): SloStatus {
  if (direction === "higher_better") {
    if (value >= target) return "healthy";
    if (value >= target * (1 - warningMargin)) return "warning";
    return "breached";
  }
  // lower_better
  if (value <= target) return "healthy";
  if (value <= target * (1 + warningMargin)) return "warning";
  return "breached";
}

/** Calcula error budget consumido como % a partir de value/target. */
function errorBudgetPct(
  value: number,
  target: number,
  direction: "higher_better" | "lower_better",
): number {
  if (direction === "higher_better") {
    // SLO 99.5% → budget = 0.5% downtime; consumed = (target - value) / (100 - target) * 100
    const allowed = 100 - target;
    if (allowed <= 0) return 0;
    const consumed = ((target - value) / allowed) * 100;
    return Math.max(0, Math.min(150, consumed));
  }
  // lower_better: latencia/tiempos. budget = 0.5 * target. consumed = (value - target) / (0.5 * target)
  const allowed = target * 0.5;
  if (allowed <= 0) return 0;
  const consumed = ((value - target) / allowed) * 100;
  return Math.max(0, Math.min(150, consumed));
}

/* -------------------------------------------------------------------------- */
/*  SLO 1 — Disponibilidad app                                                */
/* -------------------------------------------------------------------------- */
export function getAvailabilitySlo(): SloMeasurement {
  // MOCK: 99.62% (saludable, pero margen estrecho)
  // TODO Sprint 6: integrar Better Uptime / Vercel uptime API
  const value = 99.62;
  const target = 99.5;
  return {
    id: "availability_app",
    name: "Disponibilidad de la aplicación",
    category: "technical",
    sliDefinition:
      "Porcentaje de checks de uptime exitosos sobre /api/health (probe externo cada 60s).",
    value,
    target,
    direction: "higher_better",
    unit: "percentage",
    windowDays: 30,
    errorBudgetConsumedPct: errorBudgetPct(value, target, "higher_better"),
    status: deriveStatus(value, target, "higher_better"),
    alertThreshold: 99.0,
    source: "mock",
  };
}

/* -------------------------------------------------------------------------- */
/*  SLO 2 — p95 latencia /api/health                                          */
/* -------------------------------------------------------------------------- */
export function getHealthLatencySlo(): SloMeasurement {
  const value = 287;
  const target = 500;
  return {
    id: "p95_health_latency",
    name: "p95 latencia /api/health",
    category: "technical",
    sliDefinition: "Percentil 95 del tiempo de respuesta del endpoint /api/health (28d rolling).",
    value,
    target,
    direction: "lower_better",
    unit: "ms",
    windowDays: 28,
    errorBudgetConsumedPct: errorBudgetPct(value, target, "lower_better"),
    status: deriveStatus(value, target, "lower_better"),
    alertThreshold: 700,
    source: "mock",
  };
}

/* -------------------------------------------------------------------------- */
/*  SLO 3 — p95 latencia mutations tRPC                                       */
/* -------------------------------------------------------------------------- */
export function getTrpcMutationLatencySlo(): SloMeasurement {
  const value = 1180;
  const target = 1500;
  return {
    id: "p95_trpc_mutation_latency",
    name: "p95 latencia mutations tRPC",
    category: "technical",
    sliDefinition:
      "Percentil 95 del tiempo de respuesta de operaciones de escritura tRPC (admisión, triage, vitales).",
    value,
    target,
    direction: "lower_better",
    unit: "ms",
    windowDays: 28,
    errorBudgetConsumedPct: errorBudgetPct(value, target, "lower_better"),
    status: deriveStatus(value, target, "lower_better"),
    alertThreshold: 2000,
    source: "mock",
  };
}

/* -------------------------------------------------------------------------- */
/*  SLO 4 — Tasa de error 5xx                                                 */
/* -------------------------------------------------------------------------- */
export function getErrorRateSlo(): SloMeasurement {
  const value = 0.18; // 0.18%
  const target = 0.5;
  return {
    id: "error_rate_5xx",
    name: "Tasa de error 5xx",
    category: "technical",
    sliDefinition:
      "Eventos Sentry con status >= 500 / total requests servidos (excluye healthcheck).",
    value,
    target,
    direction: "lower_better",
    unit: "percentage",
    windowDays: 28,
    errorBudgetConsumedPct: errorBudgetPct(value, target, "lower_better"),
    status: deriveStatus(value, target, "lower_better"),
    alertThreshold: 1.0,
    source: "mock",
  };
}

/* -------------------------------------------------------------------------- */
/*  SLO 5 — Tasa de override de triage (clínico)                              */
/* -------------------------------------------------------------------------- */
export function getTriageOverrideSlo(): SloMeasurement {
  const value = 7.4;
  const target = 10;
  return {
    id: "triage_override_rate",
    name: "Tasa de override de triage",
    category: "clinical",
    sliDefinition:
      "% de triages donde clínico cambia el ESI sugerido por la regla automática (count override / total).",
    value,
    target,
    direction: "lower_better",
    unit: "percentage",
    windowDays: 28,
    errorBudgetConsumedPct: errorBudgetPct(value, target, "lower_better"),
    status: deriveStatus(value, target, "lower_better"),
    alertThreshold: 15,
    source: "mock",
  };
}

/* -------------------------------------------------------------------------- */
/*  SLO 6 — Tiempo admisión paciente conocido (clínico)                       */
/* -------------------------------------------------------------------------- */
export function getKnownPatientAdmissionSlo(): SloMeasurement {
  const value = 2.4;
  const target = 3;
  return {
    id: "known_patient_admission_time",
    name: "Tiempo admisión paciente conocido",
    category: "clinical",
    sliDefinition:
      "Mediana de minutos transcurridos desde el inicio de la admisión hasta confirmación cuando MPI hit-rate=match.",
    value,
    target,
    direction: "lower_better",
    unit: "minutes",
    windowDays: 28,
    errorBudgetConsumedPct: errorBudgetPct(value, target, "lower_better"),
    status: deriveStatus(value, target, "lower_better"),
    alertThreshold: 5,
    source: "mock",
  };
}

/* -------------------------------------------------------------------------- */
/*  SLO 7 — Búsqueda MPI                                                      */
/* -------------------------------------------------------------------------- */
export function getMpiSearchSlo(): SloMeasurement {
  const value = 215;
  const target = 300;
  return {
    id: "mpi_search_p95",
    name: "p95 búsqueda MPI",
    category: "technical",
    sliDefinition:
      "Percentil 95 del tiempo de respuesta de la búsqueda determinística + fuzzy en el MPI.",
    value,
    target,
    direction: "lower_better",
    unit: "ms",
    windowDays: 28,
    errorBudgetConsumedPct: errorBudgetPct(value, target, "lower_better"),
    status: deriveStatus(value, target, "lower_better"),
    alertThreshold: 500,
    source: "mock",
  };
}

/* -------------------------------------------------------------------------- */
/*  SLO 8 — RPO                                                               */
/* -------------------------------------------------------------------------- */
export function getRpoSlo(): SloMeasurement {
  const value = 12;
  const target = 15;
  return {
    id: "rpo_minutes",
    name: "RPO (Recovery Point Objective)",
    category: "technical",
    sliDefinition:
      "Intervalo máximo (en minutos) entre el último backup exitoso y el momento actual. Supabase WAL + nightly logical dump.",
    value,
    target,
    direction: "lower_better",
    unit: "minutes",
    windowDays: 1,
    errorBudgetConsumedPct: errorBudgetPct(value, target, "lower_better"),
    status: deriveStatus(value, target, "lower_better"),
    alertThreshold: 30,
    source: "mock",
  };
}

/* -------------------------------------------------------------------------- */
/*  SLO 9 — RTO                                                               */
/* -------------------------------------------------------------------------- */
export function getRtoSlo(): SloMeasurement {
  const value = 2.5;
  const target = 4;
  return {
    id: "rto_hours",
    name: "RTO (Recovery Time Objective)",
    category: "technical",
    sliDefinition:
      "Tiempo máximo (en horas) para restaurar servicio tras un incidente catastrófico. Medido en último DR drill.",
    value,
    target,
    direction: "lower_better",
    unit: "hours",
    windowDays: 90,
    errorBudgetConsumedPct: errorBudgetPct(value, target, "lower_better"),
    status: deriveStatus(value, target, "lower_better"),
    alertThreshold: 6,
    source: "mock",
  };
}

/** Devuelve todos los SLOs en orden de presentación. */
export function getAllSloMeasurements(): SloMeasurement[] {
  return [
    getAvailabilitySlo(),
    getHealthLatencySlo(),
    getTrpcMutationLatencySlo(),
    getErrorRateSlo(),
    getMpiSearchSlo(),
    getTriageOverrideSlo(),
    getKnownPatientAdmissionSlo(),
    getRpoSlo(),
    getRtoSlo(),
  ];
}

/** Helper formateo para UI. */
export function formatSloValue(m: Pick<SloMeasurement, "value" | "unit">): string {
  switch (m.unit) {
    case "percentage":
      return `${m.value.toFixed(2)}%`;
    case "ms":
      return `${Math.round(m.value)} ms`;
    case "minutes":
      return `${m.value.toFixed(1)} min`;
    case "hours":
      return `${m.value.toFixed(1)} h`;
    default:
      return String(m.value);
  }
}
