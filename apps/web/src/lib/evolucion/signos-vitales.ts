/**
 * Fuente de verdad de umbrales, rangos y helpers de signos vitales para CC-0006.
 *
 * Los rangos de validación de input coinciden con los de SignosVitalesCapture.tsx (RANGES).
 * La lógica de alertas es independiente de evaluateVitalAlerts (@his/contracts/schemas/inpatient)
 * que usa nombres de campo en inglés — esta lib usa los mismos nombres en español que
 * SignosState para facilitar la integración en pasa 2.
 */

// ─── Rangos de validación ────────────────────────────────────────────────────

export const VITAL_RANGES = {
  presionSistolica:     { min: 60,  max: 260 },
  presionDiastolica:    { min: 40,  max: 160 },
  frecuenciaCardiaca:   { min: 30,  max: 220 },
  frecuenciaRespiratoria: { min: 4, max: 60  },
  temperatura:          { min: 30,  max: 43  },
  saturacionO2:         { min: 50,  max: 100 },
  dolorEva:             { min: 0,   max: 10  },
} as const;

// ─── Tipo de entrada ─────────────────────────────────────────────────────────

/**
 * Todos los campos son opcionales para permitir capturas parciales.
 *
 * pasa-2: SignosVitalesCapture usa `escalaDolor: number` (no nullable, rango 0-10 vía slider);
 * aquí se llama `dolorEva` para alinearse con la spec CC-0006. Al integrar en pasa 2,
 * mapear: `dolorEva: signosState.escalaDolor`.
 */
export interface VitalesInput {
  presionSistolica?:      number | null;
  presionDiastolica?:     number | null;
  frecuenciaCardiaca?:    number | null;
  frecuenciaRespiratoria?: number | null;
  temperatura?:           number | null;
  saturacionO2?:          number | null;
  dolorEva?:              number | null;
}

// ─── Alertas clínicas ────────────────────────────────────────────────────────

/**
 * Evalúa umbrales clínicos y devuelve los mensajes de alerta activos.
 * Solo evalúa valores presentes (omite null / undefined / NaN).
 */
export function computeAlertasVitales(v: VitalesInput): string[] {
  const alertas: string[] = [];

  function presente(val: number | null | undefined): val is number {
    return val != null && Number.isFinite(val);
  }

  if (presente(v.saturacionO2) && v.saturacionO2 < 90) {
    alertas.push("SpO₂ baja");
  }

  if (presente(v.presionSistolica) && presente(v.presionDiastolica)) {
    if (v.presionSistolica >= 180 || v.presionDiastolica >= 110) {
      alertas.push("Crisis hipertensiva");
    }
  } else {
    // evaluación individual cuando solo viene uno de los dos
    if (presente(v.presionSistolica) && v.presionSistolica >= 180) {
      alertas.push("Crisis hipertensiva");
    }
    if (presente(v.presionDiastolica) && v.presionDiastolica >= 110) {
      alertas.push("Crisis hipertensiva");
    }
  }

  if (presente(v.presionSistolica) && v.presionSistolica < 90) {
    alertas.push("Hipotensión");
  }

  if (presente(v.temperatura)) {
    if (v.temperatura >= 39.5) alertas.push("Fiebre alta");
    else if (v.temperatura <= 35) alertas.push("Hipotermia");
  }

  if (presente(v.frecuenciaCardiaca)) {
    if (v.frecuenciaCardiaca > 120) alertas.push("Taquicardia");
    else if (v.frecuenciaCardiaca < 50) alertas.push("Bradicardia");
  }

  if (presente(v.frecuenciaRespiratoria)) {
    if (v.frecuenciaRespiratoria > 24) alertas.push("Taquipnea");
    else if (v.frecuenciaRespiratoria < 10) alertas.push("Bradipnea");
  }

  if (presente(v.dolorEva) && v.dolorEva >= 7) {
    alertas.push("Dolor intenso");
  }

  return alertas;
}

// ─── Etiquetas EVA ───────────────────────────────────────────────────────────

/**
 * Devuelve la etiqueta textual de la escala EVA (0–10).
 *
 * pasa-2: SignosVitalesCapture tiene PAIN_LABELS con 11 entradas de granularidad
 * diferente (ej. "Muy leve", "Leve-mod.", "Moderado-int.", "Severo").
 * Esta función implementa la spec CC-0006 (5 bandas). Al integrar en pasa 2,
 * usar esta función en el modal y PAIN_LABELS solo en la escala slider legacy.
 */
export function evaLabel(dolor: number): string {
  if (dolor === 0) return "Sin dolor";
  if (dolor <= 3)  return "Dolor leve";
  if (dolor <= 6)  return "Dolor moderado";
  if (dolor <= 9)  return "Dolor intenso";
  return "Dolor máximo";
}
