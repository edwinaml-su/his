/**
 * Fuente de verdad de umbrales, factores de conversión, rangos y cálculos de
 * signos vitales para la Evolución Médica (CC-0006).
 *
 * Centralizado aquí (R1) para poder tropicalizar umbrales/factores/rangos sin
 * tocar la UI. Los nombres de campo coinciden con SignosState (español) para
 * integración directa. Independiente de evaluateVitalAlerts (@his/contracts)
 * que usa nombres en inglés y corre en otra capa.
 */

// ─── Factores de conversión ──────────────────────────────────────────────────

/** 1 kg = 2.20462 lb */
export const LB_PER_KG = 2.20462;
/** 1 m = 3.28084 ft */
export const FT_PER_M = 3.28084;

// ─── Rango de edad fértil (R2, parametrizable) ───────────────────────────────

export const RANGO_EDAD_FERTIL = { min: 10, max: 55 } as const;

// ─── Rangos de validación ────────────────────────────────────────────────────

export const VITAL_RANGES = {
  presionSistolica:       { min: 60,     max: 260   },
  presionDiastolica:      { min: 40,     max: 160   },
  frecuenciaCardiaca:     { min: 30,     max: 220   },
  frecuenciaRespiratoria: { min: 4,      max: 60    },
  temperatura:            { min: 30,     max: 43    },
  saturacionO2:           { min: 50,     max: 100   },
  fio2:                   { min: 21,     max: 100   },
  glucometriaMgdl:        { min: 10,     max: 900   },
  pesoKg:                 { min: 0.5,    max: 400   },
  pesoLb:                 { min: 1,      max: 880   },
  tallaM:                 { min: 0.3,    max: 2.5   },
  tallaFt:                { min: 1,      max: 8.2   },
  perimetroCintura:       { min: 30,     max: 250   },
  balanceHidrico:         { min: -20000, max: 20000 },
  diuresisHoraria:        { min: 0,      max: 2000  },
  dolorEva:               { min: 0,      max: 10    },
} as const;

export type VitalRangeKey = keyof typeof VITAL_RANGES;

/**
 * Valida un valor numérico contra su rango. Cadena vacía = sin valor (válido).
 * Devuelve mensaje de error es-SV o null si es válido.
 */
export function validarRango(field: VitalRangeKey, raw: string): string | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Debe ser un número válido";
  const { min, max } = VITAL_RANGES[field];
  if (n < min || n > max) return `Fuera del rango aceptado (${min}–${max})`;
  return null;
}

// ─── Conversiones bidireccionales (R1.3) ─────────────────────────────────────

/** kg → lb, redondeado a 1 decimal (string para input controlado). */
export function kgALb(kg: number): string {
  return (kg * LB_PER_KG).toFixed(1);
}
/** lb → kg, redondeado a 1 decimal. */
export function lbAKg(lb: number): string {
  return (lb / LB_PER_KG).toFixed(1);
}
/** m → ft, redondeado a 2 decimales. */
export function mAFt(m: number): string {
  return (m * FT_PER_M).toFixed(2);
}
/** ft → m, redondeado a 2 decimales. */
export function ftAM(ft: number): string {
  return (ft / FT_PER_M).toFixed(2);
}

// ─── IMC (R1.3) ──────────────────────────────────────────────────────────────

/** IMC = peso(kg) / talla(m)². */
export function imcFrom(kg: number, m: number): number {
  return kg / (m * m);
}

export type ImcClaseKey = "bajo" | "normal" | "sobrepeso" | "obesidad";

export interface ImcClasificacion {
  key: ImcClaseKey;
  label: string;
}

/** Clasificación OMS del IMC. El componente mapea `key` → color del DS. */
export function imcClasificacion(imc: number): ImcClasificacion {
  if (imc < 18.5) return { key: "bajo", label: "Bajo peso" };
  if (imc < 25) return { key: "normal", label: "Normal" };
  if (imc < 30) return { key: "sobrepeso", label: "Sobrepeso" };
  return { key: "obesidad", label: "Obesidad" };
}

// ─── Índice cintura-talla (ICT) (R1.3 / spec §10.7) ──────────────────────────

/** ICT = cintura(cm) / (talla(m) × 100). */
export function ictFrom(cinturaCm: number, tallaM: number): number {
  return cinturaCm / (tallaM * 100);
}

export type IctClaseKey = "saludable" | "riesgoAumentado" | "riesgoAlto";

export interface IctClasificacion {
  key: IctClaseKey;
  label: string;
}

/** Clasificación del ICT (spec §10.7). El componente mapea `key` → color del DS. */
export function ictClasificacion(ict: number): IctClasificacion {
  if (ict < 0.5) return { key: "saludable", label: "Saludable" };
  if (ict < 0.6) return { key: "riesgoAumentado", label: "Riesgo aumentado" };
  return { key: "riesgoAlto", label: "Riesgo alto" };
}

// ─── Escala de Glasgow (R1.2) ────────────────────────────────────────────────

export const GLASGOW_OCULAR = [
  { valor: 4, label: "Espontánea" },
  { valor: 3, label: "A la voz" },
  { valor: 2, label: "Al dolor" },
  { valor: 1, label: "Ninguna" },
] as const;

export const GLASGOW_VERBAL = [
  { valor: 5, label: "Orientada" },
  { valor: 4, label: "Confusa" },
  { valor: 3, label: "Palabras inapropiadas" },
  { valor: 2, label: "Sonidos incomprensibles" },
  { valor: 1, label: "Ninguna" },
] as const;

export const GLASGOW_MOTORA = [
  { valor: 6, label: "Obedece órdenes" },
  { valor: 5, label: "Localiza el dolor" },
  { valor: 4, label: "Retira al dolor" },
  { valor: 3, label: "Flexión anormal" },
  { valor: 2, label: "Extensión anormal" },
  { valor: 1, label: "Ninguna" },
] as const;

/** Total Glasgow (3–15). null si falta alguna de las 3 respuestas. */
export function glasgowTotal(
  ocular: number | null,
  verbal: number | null,
  motora: number | null,
): number | null {
  if (ocular == null || verbal == null || motora == null) return null;
  return ocular + verbal + motora;
}

export type GlasgowSeveridad = "Leve" | "Moderado" | "Grave";

/** Severidad: Leve 13–15 · Moderado 9–12 · Grave 3–8. */
export function glasgowSeveridad(total: number): GlasgowSeveridad {
  if (total >= 13) return "Leve";
  if (total >= 9) return "Moderado";
  return "Grave";
}

// ─── Gineco-obstétrico (R1.5) ────────────────────────────────────────────────

/**
 * Fecha probable de parto por regla de Naegele:
 * a la FUR sumar 1 año, restar 3 meses y sumar 7 días.
 * Devuelve null si la FUR no es una fecha válida.
 */
export function fppNaegele(furISO: string): Date | null {
  if (!furISO) return null;
  const fur = new Date(furISO);
  if (Number.isNaN(fur.getTime())) return null;
  const fpp = new Date(fur);
  fpp.setFullYear(fpp.getFullYear() + 1);
  fpp.setMonth(fpp.getMonth() - 3);
  fpp.setDate(fpp.getDate() + 7);
  return fpp;
}

export interface Gestacion {
  semanas: number;
  dias: number;
  label: string;
}

/** Semanas de gestación desde la FUR hasta `ref` (por defecto hoy). */
export function gestacionDesdeFur(furISO: string, ref: Date = new Date()): Gestacion | null {
  if (!furISO) return null;
  const fur = new Date(furISO);
  if (Number.isNaN(fur.getTime())) return null;
  const dias = Math.floor((ref.getTime() - fur.getTime()) / 86_400_000);
  if (dias < 0) return null;
  const semanas = Math.floor(dias / 7);
  const restoDias = dias % 7;
  return { semanas, dias: restoDias, label: `${semanas} sem ${restoDias} d` };
}

// ─── Condicionales por sexo/edad (R2) ────────────────────────────────────────

/** Sexo biológico femenino (ece.paciente.sexo = 'F'). */
export function esFemenino(sexo: string | null | undefined): boolean {
  return (sexo ?? "").trim().toUpperCase() === "F";
}

/** "Puede estar embarazada" = femenino y en edad fértil (R2). */
export function puedeEmbarazo(sexo: string | null | undefined, edad: number | null | undefined): boolean {
  return (
    esFemenino(sexo) &&
    edad != null &&
    edad >= RANGO_EDAD_FERTIL.min &&
    edad <= RANGO_EDAD_FERTIL.max
  );
}

/** Edad en años a partir de la fecha de nacimiento. null si inválida. */
export function calcularEdad(fechaNacimiento: Date | string | null | undefined, ref: Date = new Date()): number | null {
  if (!fechaNacimiento) return null;
  const fn = typeof fechaNacimiento === "string" ? new Date(fechaNacimiento) : fechaNacimiento;
  if (Number.isNaN(fn.getTime())) return null;
  let edad = ref.getFullYear() - fn.getFullYear();
  const m = ref.getMonth() - fn.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < fn.getDate())) edad--;
  return edad >= 0 ? edad : null;
}

// ─── Alertas clínicas (R1.6) ─────────────────────────────────────────────────

/**
 * Entrada de alertas. Todos opcionales para permitir capturas parciales.
 * Glasgow se evalúa con las 3 respuestas (componentes); oliguria usa pesoKg.
 */
export interface VitalesInput {
  presionSistolica?:      number | null;
  presionDiastolica?:     number | null;
  frecuenciaCardiaca?:    number | null;
  frecuenciaRespiratoria?: number | null;
  temperatura?:           number | null;
  saturacionO2?:          number | null;
  dolorEva?:              number | null;
  glucometriaMgdl?:       number | null;
  glasgowOcular?:         number | null;
  glasgowVerbal?:         number | null;
  glasgowMotora?:         number | null;
  diuresisHoraria?:       number | null;
  pesoKg?:                number | null;
}

function presente(val: number | null | undefined): val is number {
  return val != null && Number.isFinite(val);
}

/**
 * Evalúa umbrales clínicos y devuelve los mensajes de alerta activos.
 * Solo evalúa valores presentes (omite null / undefined / NaN).
 */
export function computeAlertasVitales(v: VitalesInput): string[] {
  const alertas: string[] = [];

  if (presente(v.saturacionO2) && v.saturacionO2 < 90) {
    alertas.push("SpO₂ baja");
  }

  if (
    (presente(v.presionSistolica) && v.presionSistolica >= 180) ||
    (presente(v.presionDiastolica) && v.presionDiastolica >= 110)
  ) {
    alertas.push("Crisis hipertensiva");
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

  // R1.6 — glucometría
  if (presente(v.glucometriaMgdl)) {
    if (v.glucometriaMgdl < 70) alertas.push("Hipoglucemia");
    else if (v.glucometriaMgdl >= 250) alertas.push("Hiperglucemia");
  }

  // R1.6 — Glasgow ≤8 (con las 3 respuestas)
  const gcs = glasgowTotal(
    presente(v.glasgowOcular) ? v.glasgowOcular : null,
    presente(v.glasgowVerbal) ? v.glasgowVerbal : null,
    presente(v.glasgowMotora) ? v.glasgowMotora : null,
  );
  if (gcs != null && gcs <= 8) alertas.push("Glasgow ≤8");

  // R1.6 — oliguria: diuresis < 0.5 mL/kg/h (usando el peso en kg)
  if (presente(v.diuresisHoraria) && presente(v.pesoKg) && v.pesoKg > 0) {
    if (v.diuresisHoraria < 0.5 * v.pesoKg) alertas.push("Oliguria");
  }

  if (presente(v.dolorEva) && v.dolorEva >= 7) {
    alertas.push("Dolor intenso");
  }

  return alertas;
}

// ─── Etiquetas EVA ───────────────────────────────────────────────────────────

/** Etiqueta textual de la escala EVA (0–10), spec CC-0006 (5 bandas). */
export function evaLabel(dolor: number): string {
  if (dolor === 0) return "Sin dolor";
  if (dolor <= 3) return "Dolor leve";
  if (dolor <= 6) return "Dolor moderado";
  if (dolor <= 9) return "Dolor intenso";
  return "Dolor máximo";
}
