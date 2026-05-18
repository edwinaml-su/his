/**
 * Fixtures para los 8 escenarios de Hard Stop bedside (US.F2.6.27-30).
 *
 * Cada escenario define los datos mínimos necesarios para que el router
 * `nursing.bedside.validateGtin` (Stream 10) rechace la acción con el
 * código de error específico y NO cree MedicationAdministration.
 *
 * Uso en tests unitarios:
 *   const scenario = HARD_STOP_SCENARIOS["HARD_STOP-02"];
 *   expect(scenario.expectedError).toBe("MEDICAMENTO_INCORRECTO");
 *
 * Uso en E2E Playwright:
 *   const { patient, nurse, medication } = HARD_STOP_SCENARIOS["HARD_STOP-06"];
 */

export type HardStopType =
  | "HARD_STOP-01" // Paciente erróneo: GSRN pulsera no coincide con orden
  | "HARD_STOP-02" // Medicamento erróneo: GTIN no coincide con prescripción
  | "HARD_STOP-03" // Dosis errónea: presentación diferente
  | "HARD_STOP-04" // Vía errónea: oral vs IV
  | "HARD_STOP-05" // Horario erróneo: fuera de ventana terapéutica
  | "HARD_STOP-06" // Medicamento vencido: AI 17 < today
  | "HARD_STOP-07" // Lote en recall activo
  | "HARD_STOP-08"; // Enfermera GSRN revocado

export interface HardStopNurseFixture {
  mrn: string;
  fullName: string;
  gsrn: string;
  /** Si true el GSRN está inactivo en ece.gs1_gsrn */
  gsrnRevocado: boolean;
  email: string;
}

export interface HardStopPatientFixture {
  mrn: string;
  fullName: string;
  /** GSRN de pulsera asignada al paciente */
  gsrn: string;
  /** GSRN de pulsera que la enfermera va a escanear (puede diferir en HS-01) */
  gsrnEscaneado: string;
}

export interface HardStopMedicationFixture {
  /** GTIN-14 del medicamento prescripto */
  gtinPrescripto: string;
  nombrePrescripto: string;
  /** GTIN-14 que la enfermera escanea (puede diferir en HS-02) */
  gtinEscaneado: string;
  nombreEscaneado: string;
  /** Lote del DataMatrix escaneado */
  lote: string;
  /** Vencimiento en formato YYYYMMDD (AI 17) — pasado dispara HS-06 */
  vencimiento: string;
  /** true si el lote tiene recall activo en ece.gs1_gtin */
  enRecall: boolean;
  /** Concentración prescripta (ej. "500mg") */
  concentracionPrescripta: string;
  /** Concentración del medicamento escaneado (puede diferir en HS-03) */
  concentracionEscaneada: string;
}

export interface HardStopIndicationFixture {
  /** Vía prescripta */
  via: string;
  /** Vía que se presenta en el escaneo (puede diferir en HS-04) */
  viaEscaneada: string;
  /** Hora programada en formato HH:MM (hora local El Salvador) */
  horaProgramada: string;
  /** Ventana tolerada en minutos (+/-) */
  ventanaMinutos: number;
  /**
   * Offset en minutos desde horaProgramada para simular la hora de escaneo.
   * Negativo = antes, positivo = después.
   * HS-05 usa un offset que excede la ventana.
   */
  offsetEscaneoMinutos: number;
}

export interface HardStopScenario {
  type: HardStopType;
  description: string;
  expectedError: string;
  expectedErrorText: string; // Texto visible en el modal
  notificaFarmacovigilancia: boolean;
  notificaAdmin: boolean;
  nurse: HardStopNurseFixture;
  patient: HardStopPatientFixture;
  medication: HardStopMedicationFixture;
  indication: HardStopIndicationFixture;
}

// ---------------------------------------------------------------------------
// GSRN de prueba — 18 dígitos con dígito verificador válido módulo 10
// Prefijo de empresa ficticio: 801874130000xxxx
// ---------------------------------------------------------------------------

function calcGsrnCheck(first17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const weight = i % 2 === 0 ? 3 : 1;
    sum += parseInt(first17[i]!, 10) * weight;
  }
  const check = (10 - (sum % 10)) % 10;
  return first17 + String(check);
}

// GSRN pacientes
const GSRN_PAC_01 = calcGsrnCheck("80187413000000001"); // pulsera PAC-HS-01
const GSRN_PAC_02 = calcGsrnCheck("80187413000000002"); // pulsera PAC-HS-02
const GSRN_PAC_03 = calcGsrnCheck("80187413000000003");
const GSRN_PAC_04 = calcGsrnCheck("80187413000000004");
const GSRN_PAC_05 = calcGsrnCheck("80187413000000005");
const GSRN_PAC_06 = calcGsrnCheck("80187413000000006");
const GSRN_PAC_07 = calcGsrnCheck("80187413000000007");
const GSRN_PAC_08 = calcGsrnCheck("80187413000000008");

// GSRN enfermeras
const GSRN_ENF_01 = calcGsrnCheck("80187413000001001");
const GSRN_ENF_02 = calcGsrnCheck("80187413000001002");
const GSRN_ENF_03 = calcGsrnCheck("80187413000001003");
const GSRN_ENF_04 = calcGsrnCheck("80187413000001004");
const GSRN_ENF_05 = calcGsrnCheck("80187413000001005");
const GSRN_ENF_06 = calcGsrnCheck("80187413000001006");
const GSRN_ENF_07 = calcGsrnCheck("80187413000001007");
// HS-08: GSRN revocado
const GSRN_ENF_08_REVOCADO = calcGsrnCheck("80187413000001008");

// GTIN-14 — dígito verificador GS1 módulo 10
function calcGtinCheck(first13: string): string {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const weight = (13 - i) % 2 === 0 ? 3 : 1;
    sum += parseInt(first13[i]!, 10) * weight;
  }
  const check = (10 - (sum % 10)) % 10;
  return first13 + String(check);
}

const GTIN_AMOXICILINA_500 = calcGtinCheck("0750100000123"); // correcto
const GTIN_IBUPROFENO_400  = calcGtinCheck("0750100000999"); // GTIN incorrecto (HS-02)
const GTIN_AMOXICILINA_1000 = calcGtinCheck("0750100000124"); // concentración incorrecta (HS-03)
const GTIN_ENALAPRIL_10    = calcGtinCheck("0750100000125"); // vía oral — usada en HS-04

// ---------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------

export const HARD_STOP_SCENARIOS: Record<HardStopType, HardStopScenario> = {
  /** HS-01: Pulsera GSRN no coincide con el paciente de la orden activa */
  "HARD_STOP-01": {
    type: "HARD_STOP-01",
    description: "Paciente erróneo: GSRN pulsera escaneado no coincide con el paciente de la indicación",
    expectedError: "PACIENTE_INCORRECTO",
    expectedErrorText: "PACIENTE INCORRECTO",
    notificaFarmacovigilancia: false,
    notificaAdmin: false,
    nurse: {
      mrn: "ENF-HS-01",
      fullName: "Enfermera HS-01",
      gsrn: GSRN_ENF_01,
      gsrnRevocado: false,
      email: "hs01.nurse@his.test",
    },
    patient: {
      mrn: "PAC-HS-01",
      fullName: "Paciente HS-01",
      gsrn: GSRN_PAC_01,
      gsrnEscaneado: GSRN_PAC_02, // escanea la pulsera de OTRO paciente
    },
    medication: {
      gtinPrescripto: GTIN_AMOXICILINA_500,
      nombrePrescripto: "Amoxicilina 500mg",
      gtinEscaneado: GTIN_AMOXICILINA_500,
      nombreEscaneado: "Amoxicilina 500mg",
      lote: "L-HS01-2026",
      vencimiento: "20271231",
      enRecall: false,
      concentracionPrescripta: "500mg",
      concentracionEscaneada: "500mg",
    },
    indication: {
      via: "IV",
      viaEscaneada: "IV",
      horaProgramada: "08:00",
      ventanaMinutos: 30,
      offsetEscaneoMinutos: 5,
    },
  },

  /** HS-02: GTIN escaneado no coincide con la prescripción activa */
  "HARD_STOP-02": {
    type: "HARD_STOP-02",
    description: "Medicamento erróneo: GTIN escaneado no coincide con prescripción",
    expectedError: "MEDICAMENTO_INCORRECTO",
    expectedErrorText: "MEDICAMENTO INCORRECTO",
    notificaFarmacovigilancia: true,
    notificaAdmin: false,
    nurse: {
      mrn: "ENF-HS-02",
      fullName: "Enfermera HS-02",
      gsrn: GSRN_ENF_02,
      gsrnRevocado: false,
      email: "hs02.nurse@his.test",
    },
    patient: {
      mrn: "PAC-HS-02",
      fullName: "Paciente HS-02",
      gsrn: GSRN_PAC_02,
      gsrnEscaneado: GSRN_PAC_02,
    },
    medication: {
      gtinPrescripto: GTIN_AMOXICILINA_500,
      nombrePrescripto: "Amoxicilina 500mg",
      gtinEscaneado: GTIN_IBUPROFENO_400, // GTIN diferente → HS-02
      nombreEscaneado: "Ibuprofeno 400mg",
      lote: "L-HS02-2026",
      vencimiento: "20271231",
      enRecall: false,
      concentracionPrescripta: "500mg",
      concentracionEscaneada: "400mg",
    },
    indication: {
      via: "IV",
      viaEscaneada: "IV",
      horaProgramada: "08:00",
      ventanaMinutos: 30,
      offsetEscaneoMinutos: 5,
    },
  },

  /** HS-03: Concentración diferente (dosis incorrecta) */
  "HARD_STOP-03": {
    type: "HARD_STOP-03",
    description: "Dosis errónea: concentración escaneada difiere de la prescrita",
    expectedError: "DOSIS_INCORRECTA",
    expectedErrorText: "DOSIS INCORRECTA",
    notificaFarmacovigilancia: true,
    notificaAdmin: false,
    nurse: {
      mrn: "ENF-HS-03",
      fullName: "Enfermera HS-03",
      gsrn: GSRN_ENF_03,
      gsrnRevocado: false,
      email: "hs03.nurse@his.test",
    },
    patient: {
      mrn: "PAC-HS-03",
      fullName: "Paciente HS-03",
      gsrn: GSRN_PAC_03,
      gsrnEscaneado: GSRN_PAC_03,
    },
    medication: {
      gtinPrescripto: GTIN_AMOXICILINA_500,
      nombrePrescripto: "Amoxicilina 500mg",
      gtinEscaneado: GTIN_AMOXICILINA_1000, // mismo principio activo, diferente concentración
      nombreEscaneado: "Amoxicilina 1000mg",
      lote: "L-HS03-2026",
      vencimiento: "20271231",
      enRecall: false,
      concentracionPrescripta: "500mg",
      concentracionEscaneada: "1000mg",
    },
    indication: {
      via: "IV",
      viaEscaneada: "IV",
      horaProgramada: "10:00",
      ventanaMinutos: 30,
      offsetEscaneoMinutos: 10,
    },
  },

  /** HS-04: Vía de administración errónea (oral vs IV) */
  "HARD_STOP-04": {
    type: "HARD_STOP-04",
    description: "Vía errónea: indicación IV pero se escanea presentación oral",
    expectedError: "VIA_INCORRECTA",
    expectedErrorText: "VIA INCORRECTA",
    notificaFarmacovigilancia: true,
    notificaAdmin: false,
    nurse: {
      mrn: "ENF-HS-04",
      fullName: "Enfermera HS-04",
      gsrn: GSRN_ENF_04,
      gsrnRevocado: false,
      email: "hs04.nurse@his.test",
    },
    patient: {
      mrn: "PAC-HS-04",
      fullName: "Paciente HS-04",
      gsrn: GSRN_PAC_04,
      gsrnEscaneado: GSRN_PAC_04,
    },
    medication: {
      gtinPrescripto: GTIN_AMOXICILINA_500,
      nombrePrescripto: "Amoxicilina 500mg IV",
      gtinEscaneado: GTIN_ENALAPRIL_10, // GTIN asociado a presentación oral
      nombreEscaneado: "Enalapril 10mg VO",
      lote: "L-HS04-2026",
      vencimiento: "20271231",
      enRecall: false,
      concentracionPrescripta: "500mg",
      concentracionEscaneada: "10mg",
    },
    indication: {
      via: "IV",
      viaEscaneada: "VO", // oral vs IV → HS-04
      horaProgramada: "12:00",
      ventanaMinutos: 30,
      offsetEscaneoMinutos: 0,
    },
  },

  /** HS-05: Horario erróneo (fuera de ventana terapéutica) */
  "HARD_STOP-05": {
    type: "HARD_STOP-05",
    description: "Horario erróneo: administración fuera de ventana terapéutica (+/- 30 min)",
    expectedError: "HORA_FUERA_DE_VENTANA",
    expectedErrorText: "HORARIO INCORRECTO",
    notificaFarmacovigilancia: false,
    notificaAdmin: false,
    nurse: {
      mrn: "ENF-HS-05",
      fullName: "Enfermera HS-05",
      gsrn: GSRN_ENF_05,
      gsrnRevocado: false,
      email: "hs05.nurse@his.test",
    },
    patient: {
      mrn: "PAC-HS-05",
      fullName: "Paciente HS-05",
      gsrn: GSRN_PAC_05,
      gsrnEscaneado: GSRN_PAC_05,
    },
    medication: {
      gtinPrescripto: GTIN_AMOXICILINA_500,
      nombrePrescripto: "Amoxicilina 500mg",
      gtinEscaneado: GTIN_AMOXICILINA_500,
      nombreEscaneado: "Amoxicilina 500mg",
      lote: "L-HS05-2026",
      vencimiento: "20271231",
      enRecall: false,
      concentracionPrescripta: "500mg",
      concentracionEscaneada: "500mg",
    },
    indication: {
      via: "IV",
      viaEscaneada: "IV",
      horaProgramada: "08:00",
      ventanaMinutos: 30,
      offsetEscaneoMinutos: 60, // 60 min después → fuera de ventana 30 min
    },
  },

  /** HS-06: Medicamento vencido (AI 17 en el pasado) */
  "HARD_STOP-06": {
    type: "HARD_STOP-06",
    description: "Medicamento vencido: fecha AI(17) es anterior a hoy",
    expectedError: "MEDICAMENTO_VENCIDO",
    expectedErrorText: "MEDICAMENTO VENCIDO",
    notificaFarmacovigilancia: true,
    notificaAdmin: false,
    nurse: {
      mrn: "ENF-HS-06",
      fullName: "Enfermera HS-06",
      gsrn: GSRN_ENF_06,
      gsrnRevocado: false,
      email: "hs06.nurse@his.test",
    },
    patient: {
      mrn: "PAC-HS-06",
      fullName: "Paciente HS-06",
      gsrn: GSRN_PAC_06,
      gsrnEscaneado: GSRN_PAC_06,
    },
    medication: {
      gtinPrescripto: GTIN_AMOXICILINA_500,
      nombrePrescripto: "Amoxicilina 500mg",
      gtinEscaneado: GTIN_AMOXICILINA_500,
      nombreEscaneado: "Amoxicilina 500mg",
      lote: "L-HS06-VENCIDO",
      vencimiento: "20240101", // enero 2024 — pasado
      enRecall: false,
      concentracionPrescripta: "500mg",
      concentracionEscaneada: "500mg",
    },
    indication: {
      via: "IV",
      viaEscaneada: "IV",
      horaProgramada: "08:00",
      ventanaMinutos: 30,
      offsetEscaneoMinutos: 0,
    },
  },

  /** HS-07: Lote en recall activo */
  "HARD_STOP-07": {
    type: "HARD_STOP-07",
    description: "Lote en recall activo: el catálogo marca recall para este lote",
    expectedError: "LOTE_EN_RECALL",
    expectedErrorText: "LOTE EN RECALL",
    notificaFarmacovigilancia: true,
    notificaAdmin: false,
    nurse: {
      mrn: "ENF-HS-07",
      fullName: "Enfermera HS-07",
      gsrn: GSRN_ENF_07,
      gsrnRevocado: false,
      email: "hs07.nurse@his.test",
    },
    patient: {
      mrn: "PAC-HS-07",
      fullName: "Paciente HS-07",
      gsrn: GSRN_PAC_07,
      gsrnEscaneado: GSRN_PAC_07,
    },
    medication: {
      gtinPrescripto: GTIN_AMOXICILINA_500,
      nombrePrescripto: "Amoxicilina 500mg",
      gtinEscaneado: GTIN_AMOXICILINA_500,
      nombreEscaneado: "Amoxicilina 500mg",
      lote: "L-RECALL-2026", // marcado como recall en ece.gs1_gtin
      vencimiento: "20271231",
      enRecall: true, // flag que el seed usa para marcar recall
      concentracionPrescripta: "500mg",
      concentracionEscaneada: "500mg",
    },
    indication: {
      via: "IV",
      viaEscaneada: "IV",
      horaProgramada: "08:00",
      ventanaMinutos: 30,
      offsetEscaneoMinutos: 5,
    },
  },

  /** HS-08: GSRN de enfermera revocado */
  "HARD_STOP-08": {
    type: "HARD_STOP-08",
    description: "Enfermera GSRN revocado: el GSRN está inactivo en el catálogo",
    expectedError: "PROFESIONAL_NO_HABILITADO",
    expectedErrorText: "PROFESIONAL NO HABILITADO",
    notificaFarmacovigilancia: false,
    notificaAdmin: true,
    nurse: {
      mrn: "ENF-HS-08",
      fullName: "Enfermera HS-08 (GSRN Revocado)",
      gsrn: GSRN_ENF_08_REVOCADO,
      gsrnRevocado: true, // este GSRN quedará inactivo en el seed
      email: "hs08.nurse@his.test",
    },
    patient: {
      mrn: "PAC-HS-08",
      fullName: "Paciente HS-08",
      gsrn: GSRN_PAC_08,
      gsrnEscaneado: GSRN_PAC_08,
    },
    medication: {
      gtinPrescripto: GTIN_AMOXICILINA_500,
      nombrePrescripto: "Amoxicilina 500mg",
      gtinEscaneado: GTIN_AMOXICILINA_500,
      nombreEscaneado: "Amoxicilina 500mg",
      lote: "L-HS08-2026",
      vencimiento: "20271231",
      enRecall: false,
      concentracionPrescripta: "500mg",
      concentracionEscaneada: "500mg",
    },
    indication: {
      via: "IV",
      viaEscaneada: "IV",
      horaProgramada: "08:00",
      ventanaMinutos: 30,
      offsetEscaneoMinutos: 0,
    },
  },
} as const;

/** Devuelve todos los escenarios como array ordenado. */
export const ALL_HARD_STOP_SCENARIOS = Object.values(HARD_STOP_SCENARIOS);

/** GSRN values exportados para seed scripts */
export const GSRN_VALUES = {
  patients: {
    HS01: GSRN_PAC_01,
    HS02: GSRN_PAC_02,
    HS03: GSRN_PAC_03,
    HS04: GSRN_PAC_04,
    HS05: GSRN_PAC_05,
    HS06: GSRN_PAC_06,
    HS07: GSRN_PAC_07,
    HS08: GSRN_PAC_08,
  },
  nurses: {
    HS01: GSRN_ENF_01,
    HS02: GSRN_ENF_02,
    HS03: GSRN_ENF_03,
    HS04: GSRN_ENF_04,
    HS05: GSRN_ENF_05,
    HS06: GSRN_ENF_06,
    HS07: GSRN_ENF_07,
    HS08_REVOCADO: GSRN_ENF_08_REVOCADO,
  },
} as const;

/** GTIN values exportados para seed scripts */
export const GTIN_VALUES = {
  AMOXICILINA_500: GTIN_AMOXICILINA_500,
  IBUPROFENO_400: GTIN_IBUPROFENO_400,
  AMOXICILINA_1000: GTIN_AMOXICILINA_1000,
  ENALAPRIL_10: GTIN_ENALAPRIL_10,
} as const;
