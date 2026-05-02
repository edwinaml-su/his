/**
 * US-6.2 — reglas de alerta automática para signos vitales en triage.
 *
 * Umbrales basados en TDR §9.2 + Manchester Triage Group "discriminator
 * thresholds" + ATLS para Glasgow ≤ 8 (vía aérea comprometida).
 *
 *  SPO2  < 90       → CRITICAL  "Hipoxia severa"
 *  SPO2  90-94      → WARNING   "Hipoxia"
 *  HR    > 130      → WARNING   "Taquicardia"
 *  HR    < 50       → CRITICAL  "Bradicardia"
 *  BP_SYS > 180     → WARNING   "Hipertensión severa"
 *  BP_SYS < 90      → CRITICAL  "Hipotensión / shock"
 *  TEMP  > 39       → WARNING   "Fiebre alta"
 *  GCS   < 9        → CRITICAL  "Glasgow ≤8 — vía aérea"
 *  PAIN  >= 7       → INFO      "Dolor severo"
 *
 * Pensado para correr en cliente (rebanner en cada onChange) y en servidor
 * (validación pre-persist) — sin dependencias de runtime.
 */
import type { TriageVitalCode, VitalAlert, VitalAlertSeverity } from "@his/contracts";

export type { TriageVitalCode, VitalAlert, VitalAlertSeverity };

export interface VitalReading {
  vitalCode: TriageVitalCode;
  valueNumeric?: number | null;
}

const RULES: ReadonlyArray<(v: Map<TriageVitalCode, number>) => VitalAlert | null> = [
  (m) => {
    const x = m.get("SPO2");
    if (x == null) return null;
    if (x < 90) return { vitalCode: "SPO2", severity: "CRITICAL", message: "Hipoxia severa" };
    if (x < 95) return { vitalCode: "SPO2", severity: "WARNING", message: "Hipoxia" };
    return null;
  },
  (m) => {
    const x = m.get("HR");
    if (x == null) return null;
    if (x < 50) return { vitalCode: "HR", severity: "CRITICAL", message: "Bradicardia" };
    if (x > 130) return { vitalCode: "HR", severity: "WARNING", message: "Taquicardia" };
    return null;
  },
  (m) => {
    const x = m.get("BP_SYS");
    if (x == null) return null;
    if (x < 90) return { vitalCode: "BP_SYS", severity: "CRITICAL", message: "Hipotensión / shock" };
    if (x > 180) return { vitalCode: "BP_SYS", severity: "WARNING", message: "Hipertensión severa" };
    return null;
  },
  (m) => {
    const x = m.get("TEMP");
    if (x != null && x > 39) {
      return { vitalCode: "TEMP", severity: "WARNING", message: "Fiebre alta" };
    }
    return null;
  },
  (m) => {
    const x = m.get("GCS");
    if (x != null && x < 9) {
      return { vitalCode: "GCS", severity: "CRITICAL", message: "Glasgow ≤8 — vía aérea" };
    }
    return null;
  },
  (m) => {
    const x = m.get("PAIN");
    if (x != null && x >= 7) {
      return { vitalCode: "PAIN", severity: "INFO", message: "Dolor severo" };
    }
    return null;
  },
];

/**
 * Calcula alertas a partir del set de lecturas. Sólo considera valores
 * numéricos finitos. No deduplica por código: cada regla emite a lo sumo
 * una alerta por vital.
 */
export function computeAlerts(readings: readonly VitalReading[]): VitalAlert[] {
  const map = new Map<TriageVitalCode, number>();
  for (const r of readings) {
    if (r.valueNumeric == null || !Number.isFinite(r.valueNumeric)) continue;
    map.set(r.vitalCode, r.valueNumeric);
  }
  const out: VitalAlert[] = [];
  for (const rule of RULES) {
    const a = rule(map);
    if (a) out.push(a);
  }
  // Critical > Warning > Info para que el banner muestre lo más urgente arriba.
  const order: Record<VitalAlertSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function maxSeverity(alerts: readonly VitalAlert[]): VitalAlertSeverity | null {
  if (alerts.length === 0) return null;
  if (alerts.some((a) => a.severity === "CRITICAL")) return "CRITICAL";
  if (alerts.some((a) => a.severity === "WARNING")) return "WARNING";
  return "INFO";
}
