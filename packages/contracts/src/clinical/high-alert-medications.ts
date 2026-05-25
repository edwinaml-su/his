/**
 * JCI Standard: IPSG.3 ME 1 — High-Alert Medications
 * ISMP (Institute for Safe Medication Practices) classification helpers.
 *
 * Estos helpers son la fuente de verdad para UI y lógica de negocio sobre
 * niveles de alerta. El constraint CHECK en BD es la guardia definitiva.
 */

export const ALERT_LEVELS = ['standard', 'high', 'very_high', 'critical'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/**
 * Retorna true si el medicamento requiere precauciones adicionales ISMP.
 * Equivale a alertLevel != 'standard'.
 */
export function isHighAlert(level: string): boolean {
  return level === 'high' || level === 'very_high' || level === 'critical';
}

/**
 * Retorna true si el medicamento requiere doble verificación independiente
 * antes de la administración (IPSG.3 ME 1).
 * Aplica a: high, very_high, critical.
 */
export function requiresDoubleCheck(level: string): boolean {
  return level === 'high' || level === 'very_high' || level === 'critical';
}

/**
 * Retorna el color semántico para mostrar el nivel de alerta en UI.
 * Paleta: gray (estándar) / amber (high) / orange (very_high) / red (critical).
 */
export function getColorForLevel(level: string): 'gray' | 'amber' | 'orange' | 'red' {
  switch (level) {
    case 'high':      return 'amber';
    case 'very_high': return 'orange';
    case 'critical':  return 'red';
    default:          return 'gray';
  }
}
