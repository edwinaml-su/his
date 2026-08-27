// config/slos.js — SLOs centralizados, REQ-HIS-PERF-001 §7.
//
// Única fuente de verdad para los umbrales de la suite A-F. No dupliques
// estos números dentro de un scenario — importá desde acá y, si hace falta
// calibrar, cambiá solo este archivo (criterio de aceptación §12: "Umbrales/
// SLOs centralizados y aplicados como thresholds de k6").

export const SLO = {
  /** Lecturas: p95 < 400ms, p99 < 800ms. */
  readP95Ms: 400,
  readP99Ms: 800,
  /** Escrituras: p95 < 700ms. */
  writeP95Ms: 700,
  /** Tasa de error (5xx / tRPC error) < 1%. */
  errorRateMax: 0.01,
  /** Disponibilidad durante la corrida >= 99% — equivalente a error rate <= 1%
   *  medido sobre el total de requests HTTP de la corrida completa. */
  availabilityMin: 0.99,
};

/**
 * mixedReadWriteThresholds — para escenarios que mezclan lectura/escritura.
 * Requiere que las llamadas usen `tags: { op: 'read' | 'write' }` (ver
 * lib/trpc.js — trpcQuery/trpcMutation ya taggean automáticamente).
 *
 * `phase:load` filtra el tráfico de setup() (login + catálogos + lookup de
 * episodio de referencia, que corre 1 vez y no es el flujo medido) fuera del
 * threshold — hallazgo real de la primera corrida contra la app (2026-08-18):
 * un 404/500 de setup() estaba contaminando el error rate de toda la corrida.
 */
export function mixedReadWriteThresholds() {
  return {
    'http_req_duration{op:read,phase:load}': [`p(95)<${SLO.readP95Ms}`, `p(99)<${SLO.readP99Ms}`],
    'http_req_duration{op:write,phase:load}': [`p(95)<${SLO.writeP95Ms}`],
    'http_req_failed{phase:load}': [`rate<${SLO.errorRateMax}`],
    checks: [`rate>${1 - SLO.errorRateMax}`],
  };
}

/** readOnlyThresholds — para escenarios 100% lectura (ej. dashboard §6 flujo 6). */
export function readOnlyThresholds() {
  return {
    'http_req_duration{phase:load}': [`p(95)<${SLO.readP95Ms}`, `p(99)<${SLO.readP99Ms}`],
    'http_req_failed{phase:load}': [`rate<${SLO.errorRateMax}`],
    checks: [`rate>${1 - SLO.errorRateMax}`],
  };
}

/**
 * stressThresholds — para C (Estrés) y D (Spike): NO deben abortar la
 * corrida si se degrada (ese es el punto del escenario — encontrar el knee
 * point), pero sí quedan reportados como threshold para que el resumen
 * marque objetivamente si el sistema sostuvo el SLO o no bajo la rampa.
 * `abortOnFail` se deja en false explícitamente en cada scenario.
 */
export function stressThresholds() {
  return {
    'http_req_duration{op:read,phase:load}': [`p(95)<${SLO.readP95Ms}`, `p(99)<${SLO.readP99Ms}`],
    'http_req_duration{op:write,phase:load}': [`p(95)<${SLO.writeP95Ms}`],
    'http_req_failed{phase:load}': [`rate<${SLO.errorRateMax}`],
  };
}
