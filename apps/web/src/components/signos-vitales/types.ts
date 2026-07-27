/**
 * Tipos y helpers puros del estado de captura de Signos Vitales — módulo
 * transversal CC-0012 (mockup avante7). Generalizado desde `SignosState`
 * (CC-0006 evolución médica, ver `apps/web/src/app/(clinical)/ece/evolucion/
 * nueva/_lib/types.ts`) con un campo adicional (`fppActivo`) porque este
 * módulo SÍ persiste el estado del interruptor FPP (a diferencia de
 * evolución, donde es puramente derivado en UI).
 *
 * Sin dependencias de React — facilita tests unitarios puros.
 */

/**
 * Estado de los signos vitales como strings (facilita inputs controlados).
 * `escalaDolor` es number (slider, no puede quedar vacío).
 */
export interface VitalesFormState {
  // Núcleo — obligatorio para guardar
  presionSistolica: string;
  presionDiastolica: string;
  frecuenciaCardiaca: string;
  frecuenciaRespiratoria: string;
  temperatura: string;
  saturacionO2: string;
  fio2: string;
  // Estado neurológico y metabólico
  glasgowOcular: string;
  glasgowVerbal: string;
  glasgowMotora: string;
  glucometriaMgdl: string;
  // Antropometría
  pesoKg: string;
  pesoLb: string;
  tallaM: string;
  tallaFt: string;
  perimetroCintura: string;
  // Balance hídrico
  balanceHidrico: string;
  diuresisHoraria: string;
  // Gineco-obstétrico
  fechaUltimaRegla: string;
  /** CC-0012 — estado del interruptor "FPP (Naegele)" al guardar. Se persiste. */
  fppActivo: boolean;
  gestaG: string;
  partoTermino: string;
  partoPretermino: string;
  abortos: string;
  vivos: string;
  // Dolor (EVA)
  escalaDolor: number;
}

export const VITALES_FORM_EMPTY: VitalesFormState = {
  presionSistolica: "",
  presionDiastolica: "",
  frecuenciaCardiaca: "",
  frecuenciaRespiratoria: "",
  temperatura: "",
  saturacionO2: "",
  fio2: "",
  glasgowOcular: "",
  glasgowVerbal: "",
  glasgowMotora: "",
  glucometriaMgdl: "",
  pesoKg: "",
  pesoLb: "",
  tallaM: "",
  tallaFt: "",
  perimetroCintura: "",
  balanceHidrico: "",
  diuresisHoraria: "",
  fechaUltimaRegla: "",
  fppActivo: false,
  gestaG: "",
  partoTermino: "",
  partoPretermino: "",
  abortos: "",
  vivos: "",
  escalaDolor: 0,
};

/** true si hay al menos un campo capturado (dolor > 0 cuenta como dato). */
export function tieneSignosForm(s: VitalesFormState): boolean {
  const { escalaDolor, fppActivo: _fppActivo, ...campos } = s;
  return escalaDolor > 0 || Object.values(campos).some((v) => v.trim() !== "");
}

/**
 * Núcleo de signos vitales obligatorio para guardar (mockup avante7 §L1037):
 * Presión arterial (sistólica + diastólica) y Oxigenación/cardiorrespiratorio
 * (FC, FR, Temperatura, SpO₂, FiO₂) = 7 campos. El resto es opcional.
 */
export const SIGNOS_NUCLEO = [
  "presionSistolica",
  "presionDiastolica",
  "frecuenciaCardiaca",
  "frecuenciaRespiratoria",
  "temperatura",
  "saturacionO2",
  "fio2",
] as const;

export function signosNucleoCompletos(s: VitalesFormState): boolean {
  return SIGNOS_NUCLEO.every((k) => s[k].trim() !== "");
}

/** Los 5 campos G·P·P·A·V exigidos al guardar signos de una paciente femenina. */
export const FORMULA_OBSTETRICA = [
  "gestaG",
  "partoTermino",
  "partoPretermino",
  "abortos",
  "vivos",
] as const;

export function formulaObstetricaCompleta(s: VitalesFormState): boolean {
  return FORMULA_OBSTETRICA.every((k) => s[k].trim() !== "");
}
