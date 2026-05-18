/**
 * Fixtures para tests del Algoritmo 5 Correctos bedside (US.F2.6.21-22).
 *
 * Contiene:
 *  - Códigos GS1 válidos con dígito verificador correcto.
 *  - DataMatrix strings de prueba (formato parentético y FNC1).
 *  - Mocks de indicaciones médicas activas e inactivas.
 *  - Escenarios de ventana terapéutica.
 */

// ---------------------------------------------------------------------------
// GS1 Helper — dígito verificador Módulo-10
// ---------------------------------------------------------------------------

function gs1CheckDigit(root: string): string {
  const len = root.length;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const rightPos = len - 1 - i;
    const weight = rightPos % 2 === 0 ? 3 : 1;
    sum += parseInt(root[i]!, 10) * weight;
  }
  return root + ((10 - (sum % 10)) % 10).toString();
}

// ---------------------------------------------------------------------------
// Códigos GS1 de prueba
// ---------------------------------------------------------------------------

/** GTIN-14 de Amoxicilina 500mg para pruebas. */
export const GTIN_AMOXICILINA_500MG = gs1CheckDigit("0750100000123");  // 14 dígitos

/** GTIN-14 de un medicamento diferente (para hard-stop MEDICAMENTO_NO_COINCIDE). */
export const GTIN_IBUPROFENO_400MG  = gs1CheckDigit("0750100000999");

/** GTIN-14 con dosis 1000mg (para hard-stop DOSIS_INCORRECTA). */
export const GTIN_AMOXICILINA_1000MG = gs1CheckDigit("0750100001000");

/** GSRN-18 de paciente PAC-001 (activo en catálogo). */
export const GSRN_PACIENTE_001 = gs1CheckDigit("80187413000000001".padStart(17, "0"));

/** GSRN-18 de paciente PAC-002 (diferente organización). */
export const GSRN_PACIENTE_002 = gs1CheckDigit("80187413000000002".padStart(17, "0"));

/** GSRN-18 de paciente sin registro en catálogo. */
export const GSRN_PACIENTE_SIN_REGISTRO = gs1CheckDigit("80187413000099999".padStart(17, "0"));

/** GSRN-18 de la enfermera ENF-001. */
export const GSRN_ENFERMERA_001 = gs1CheckDigit("80187413000000100".padStart(17, "0"));

/** GLN-13 del servicio de Medicina Interna. */
export const GLN_MEDICINA_INTERNA = gs1CheckDigit("741300000001" );

// ---------------------------------------------------------------------------
// DataMatrix strings de prueba
// ---------------------------------------------------------------------------

/**
 * DataMatrix GS1 en formato parentético para Amoxicilina 500mg.
 * GTIN + lote + vencimiento + serie.
 */
export const DM_AMOXICILINA_OK = `(01)${GTIN_AMOXICILINA_500MG}(10)L2024A(17)261231(21)SER0001`;

/** DataMatrix con GTIN de Ibuprofeno (medicamento incorrecto). */
export const DM_IBUPROFENO = `(01)${GTIN_IBUPROFENO_400MG}(10)L2024B(17)261231(21)SER0002`;

/** DataMatrix con GTIN de dosis alta (dosis incorrecta). */
export const DM_AMOXICILINA_DOSIS_ALTA = `(01)${GTIN_AMOXICILINA_1000MG}(10)L2024C(17)261231(21)SER0003`;

/** DataMatrix completamente inválido (no GS1). */
export const DM_INVALIDO = "ABC123-NO-GS1-FORMAT";

/** DataMatrix con FNC1 como separador (0x1D). */
export const DM_CON_FNC1 = `01${GTIN_AMOXICILINA_500MG}\x1D10L2024A\x1D17261231\x1D21SER0001`;

// ---------------------------------------------------------------------------
// UUIDs para tests
// ---------------------------------------------------------------------------

export const UUID_ORG           = "aaaaaaaa-0000-0000-0000-000000000001";
export const UUID_PATIENT_001   = "bbbbbbbb-0000-0000-0000-000000000001";
export const UUID_PATIENT_002   = "bbbbbbbb-0000-0000-0000-000000000002";
export const UUID_INDICATION_01 = "cccccccc-0000-0000-0000-000000000001";
export const UUID_INDICATION_02 = "cccccccc-0000-0000-0000-000000000002";

// ---------------------------------------------------------------------------
// Mocks de filas de BD
// ---------------------------------------------------------------------------

/** Fila GSRN válida para paciente activo. */
export const MOCK_GSRN_ROW_ACTIVO = {
  referencia_id: UUID_PATIENT_001,
  activo: true,
};

/** Fila GSRN para paciente inactivo (revocado). */
export const MOCK_GSRN_ROW_INACTIVO = {
  referencia_id: UUID_PATIENT_001,
  activo: false,
};

/** Indicación médica activa con GTIN de Amoxicilina 500mg. */
export const MOCK_INDICATION_ACTIVA = {
  id: UUID_INDICATION_01,
  patient_id: UUID_PATIENT_001,
  patient_gsrn: GSRN_PACIENTE_001,
  gtin: GTIN_AMOXICILINA_500MG,
  dose: "500mg",
  route: "oral",
  frequency: "cada 8h",
  status: "ACTIVA",
};

/** Indicación activa sin GTIN (por si la orden no tiene GTIN aún). */
export const MOCK_INDICATION_SIN_GTIN = {
  ...MOCK_INDICATION_ACTIVA,
  gtin: null,
};

/** Indicación cancelada. */
export const MOCK_INDICATION_CANCELADA = {
  ...MOCK_INDICATION_ACTIVA,
  status: "CANCELADA",
};

/** Fila GTIN del catálogo para Amoxicilina 500mg. */
export const MOCK_GTIN_AMOXICILINA_500 = {
  presentacion: "Amoxicilina 500mg/cap",
};

/** Fila GTIN del catálogo para Amoxicilina 1000mg. */
export const MOCK_GTIN_AMOXICILINA_1000 = {
  presentacion: "Amoxicilina 1000mg/cap",
};

/**
 * Última administración hace 4 horas (dentro de ventana para freq 8h).
 * Ventana 8h ± 30min → válido entre 7h30m y 8h30m desde lastAdmin.
 */
export function lastAdminHace4h(): Date {
  return new Date(Date.now() - 4 * 60 * 60_000);
}

/**
 * Última administración hace 1 hora — demasiado pronto para dosis 8h.
 * Con tolerancia 30min, la próxima ventana empieza en ~7h30m.
 */
export function lastAdminHace1h(): Date {
  return new Date(Date.now() - 1 * 60 * 60_000);
}

/** Fila de MedicationAdministration con administración hace 4 horas. */
export function mockLastAdminRow(date: Date) {
  return { administered_at: date };
}
