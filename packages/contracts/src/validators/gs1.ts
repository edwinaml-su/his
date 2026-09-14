/**
 * Validadores GS1 — GSRN (AI 8018) con paridad lógica a implementar en SQL.
 *
 * GSRN: Global Service Relation Number.
 * Formato: 18 dígitos = prefijo empresa (7–9 dígitos) + serial paciente + dígito
 * verificador (Luhn/Módulo-10 GS1 estándar).
 *
 * AI 8018 = identificador de relación de servicio.
 * Referencia: GS1 General Specifications v22.
 */

const GSRN_LENGTH = 18;

/** Luhn/Módulo-10 GS1: dígitos pares (desde la derecha, sin el check) × 3, impares × 1. */
function gs1Mod10CheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = Number.parseInt(digits.charAt(i), 10);
    // posición desde la derecha (1-based) → si está en posición impar desde derecha = ×3
    const fromRight = digits.length - i;
    sum += fromRight % 2 === 0 ? d : d * 3;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

/**
 * Valida un GSRN de 18 dígitos usando Módulo-10 GS1.
 * Acepta strings con o sin espacios/guiones.
 */
export function validateGSRN(input: string | null | undefined): boolean {
  if (!input) return false;
  const clean = input.replace(/\D/g, "");
  if (clean.length !== GSRN_LENGTH) return false;
  const body = clean.slice(0, GSRN_LENGTH - 1);
  const check = Number.parseInt(clean.charAt(GSRN_LENGTH - 1), 10);
  return gs1Mod10CheckDigit(body) === check;
}

/**
 * Genera un GSRN válido dado el prefijo de empresa y el número de serie del paciente.
 *
 * @param companyPrefix - prefijo GS1 de la empresa (7–9 dígitos)
 * @param patientSerial - número serial del paciente (auto-incremental, sin padding)
 * @returns string de 18 dígitos (GSRN completo con dígito verificador)
 * @throws si companyPrefix tiene longitud fuera de rango o serial es negativo
 */
export function buildGSRN(companyPrefix: string, patientSerial: number): string {
  if (companyPrefix.length < 7 || companyPrefix.length > 9) {
    throw new Error(
      `companyPrefix debe tener entre 7 y 9 dígitos (recibido: ${companyPrefix.length})`,
    );
  }
  if (!/^\d+$/.test(companyPrefix)) {
    throw new Error("companyPrefix debe contener solo dígitos");
  }
  if (patientSerial < 0 || !Number.isInteger(patientSerial)) {
    throw new Error("patientSerial debe ser un entero no negativo");
  }

  // La parte de referencia ocupa 17 - prefijo.length dígitos
  const refLength = GSRN_LENGTH - 1 - companyPrefix.length;
  const serial = String(patientSerial).padStart(refLength, "0");
  if (serial.length > refLength) {
    throw new Error(
      `patientSerial excede el espacio disponible (max ${refLength} dígitos para prefijo de ${companyPrefix.length})`,
    );
  }

  const body = companyPrefix + serial;
  const check = gs1Mod10CheckDigit(body);
  return body + String(check);
}

// ---------------------------------------------------------------------------
// GTIN-14 interno para unidosis sin código de fabricante (guía GS1 El Salvador §6.2)
// ---------------------------------------------------------------------------

const GTIN_LENGTH = 14;

/**
 * Genera un GTIN-14 interno válido para una unidosis huérfana de código de origen.
 * Estructura: prefijo institucional + serial (padded) + dígito verificador Módulo-10.
 *
 * @param companyPrefix - prefijo GS1 institucional (6–12 dígitos)
 * @param serial - serial interno de la unidosis (entero no negativo)
 */
export function buildInternalGtin(companyPrefix: string, serial: number): string {
  if (companyPrefix.length < 6 || companyPrefix.length > 12) {
    throw new Error(
      `companyPrefix debe tener entre 6 y 12 dígitos (recibido: ${companyPrefix.length})`,
    );
  }
  if (!/^\d+$/.test(companyPrefix)) {
    throw new Error("companyPrefix debe contener solo dígitos");
  }
  if (serial < 0 || !Number.isInteger(serial)) {
    throw new Error("serial debe ser un entero no negativo");
  }
  const refLength = GTIN_LENGTH - 1 - companyPrefix.length;
  const ref = String(serial).padStart(refLength, "0");
  if (ref.length > refLength) {
    throw new Error(`serial excede el espacio disponible (max ${refLength} dígitos)`);
  }
  const body = companyPrefix + ref;
  return body + String(gs1Mod10CheckDigit(body));
}

/**
 * Arma el string de elementos GS1 (GS1 DataMatrix) heredando lote/vencimiento del
 * empaque padre: (01) GTIN + (17) vencimiento YYMMDD + (10) lote.
 * El AI (10) lote es de longitud variable y va al final (regla GS1).
 */
export function buildGs1DataMatrix(
  gtin: string,
  lote: string,
  vencimientoYYMMDD?: string,
): string {
  let s = `(01)${gtin}`;
  if (vencimientoYYMMDD) s += `(17)${vencimientoYYMMDD}`;
  s += `(10)${lote}`;
  return s;
}

/**
 * Devuelve el dígito verificador GS1 módulo-10 para un string de 17 dígitos.
 * Utilidad de bajo nivel expuesta para tests y paridad SQL.
 */
export { gs1Mod10CheckDigit };

/**
 * Parser GS1 Application Identifiers (AI) para strings DataMatrix.
 * Ref: GS1 General Specifications v23, sección 7.
 * Puro y sin side-effects: testeable en cualquier entorno (node, jsdom, worker).
 */

export interface Gs1Data {
  gtin?: string;
  lot?: string;
  /** Formato YYMMDD (GS1), ya validado que sea parseable. */
  expiry?: string;
  serial?: string;
  /** AI 8004 — GIAI (Global Individual Asset Identifier), ver §CC-0029 abajo. */
  giai?: string;
}

export interface Gs1ParseError {
  code: "INVALID_GTIN_LENGTH" | "INVALID_GTIN_CHECKSUM" | "EMPTY_INPUT";
  message: string;
}

export type Gs1ParseResult =
  | { ok: true; data: Gs1Data }
  | { ok: false; error: Gs1ParseError };

// GS1 usa FNC1 (0x1D) como separador de variable-length AIs.
const FNC1 = "\x1D";

// AIs con longitud fija (no necesitan FNC1 como terminador).
const FIXED_LENGTH_AIS: Record<string, number> = {
  "01": 14, // GTIN
  "11": 6,  // Production date
  "13": 6,  // Packaging date
  "15": 6,  // Best before
  "17": 6,  // Expiry date
  "20": 2,  // Variant
  "31": 6,  // Net weight kg
  "32": 6,
  "33": 6,
  "34": 6,
  "35": 6,
  "36": 6,
};

/**
 * Valida checksum GS1 (Mod 10) de un GTIN-14.
 * Devuelve true si el dígito de chequeo es correcto.
 */
export function validateGtinChecksum(gtin: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(gtin)) return false;

  // Pad a 14 dígitos
  const padded = gtin.padStart(14, "0");
  const digits = padded.split("").map(Number);
  const checkDigit = digits.pop()!;

  // Multiplica posiciones alternadas por 3 y 1 (desde la derecha, el primer
  // dígito del payload tiene factor 3).
  const sum = digits.reduce((acc, d, i) => {
    const factor = (digits.length - i) % 2 === 0 ? 1 : 3;
    return acc + d * factor;
  }, 0);

  const expected = (10 - (sum % 10)) % 10;
  return checkDigit === expected;
}

/**
 * Parsea un string GS1 DataMatrix (puede contener FNC1 / ]d2 header).
 * Extrae AIs: 01 (GTIN), 10 (lot), 17 (expiry), 21 (serial).
 */
export function parseGs1String(raw: string): Gs1ParseResult {
  if (!raw || raw.trim().length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_INPUT", message: "El string GS1 está vacío." },
    };
  }

  // Eliminar header ]d2 / ]C1 que @zxing puede incluir.
  const input = raw.replace(/^\]d2|^\]C1|^\]e0/i, "");

  const result: Gs1Data = {};
  let pos = 0;

  while (pos < input.length) {
    // Consumir FNC1 si está al inicio de un segmento.
    if (input[pos] === FNC1) {
      pos++;
      continue;
    }

    // Determinar el AI (2 o 3 dígitos).
    const ai2 = input.substring(pos, pos + 2);
    const ai3 = input.substring(pos, pos + 3);

    // AI de longitud fija conocida.
    if (ai2 in FIXED_LENGTH_AIS) {
      const len = FIXED_LENGTH_AIS[ai2]!;
      const value = input.substring(pos + 2, pos + 2 + len);
      applyAi(result, ai2, value);
      pos += 2 + len;
    } else if (ai3 in FIXED_LENGTH_AIS) {
      const len = FIXED_LENGTH_AIS[ai3]!;
      const value = input.substring(pos + 3, pos + 3 + len);
      applyAi(result, ai3, value);
      pos += 3 + len;
    } else {
      // Variable-length AI: leer hasta FNC1 o fin de string.
      // AI 8004 (GIAI) es de 4 dígitos — se detecta explícitamente porque no
      // encaja en la heurística de 2/3 dígitos usada para el resto de AIs.
      const ai4 = input.substring(pos, pos + 4);
      const aiLen = ai4 === "8004" ? 4 : ai3.startsWith("39") || ai3.startsWith("71") ? 3 : 2;
      const ai = input.substring(pos, pos + aiLen);
      pos += aiLen;
      const end = input.indexOf(FNC1, pos);
      const value = end === -1 ? input.substring(pos) : input.substring(pos, end);
      applyAi(result, ai, value);
      pos = end === -1 ? input.length : end;
    }
  }

  if (result.gtin !== undefined && !validateGtinChecksum(result.gtin)) {
    return {
      ok: false,
      error: {
        code: "INVALID_GTIN_CHECKSUM",
        message: `GTIN "${result.gtin}" falló verificación checksum Mod-10.`,
      },
    };
  }

  if (result.gtin !== undefined && result.gtin.length !== 14) {
    return {
      ok: false,
      error: {
        code: "INVALID_GTIN_LENGTH",
        message: `GTIN debe tener 14 dígitos, recibido: ${result.gtin.length}.`,
      },
    };
  }

  return { ok: true, data: result };
}

function applyAi(result: Gs1Data, ai: string, value: string): void {
  switch (ai) {
    case "01":
      result.gtin = value;
      break;
    case "10":
      result.lot = value;
      break;
    case "17":
      result.expiry = value;
      break;
    case "21":
      result.serial = value;
      break;
    case "8004":
      result.giai = value;
      break;
    // Otros AIs ignorados — extensible sin romper API.
  }
}

// =============================================================================
// US.F2.6.44 — Validador checksums multi-AI (GS1 Módulo-10)
// Soporta: AI 01 (GTIN-14), AI 8018 (GSRN-18), AI 00 (SSCC-18), AI 8003 (GRAI)
// =============================================================================

/**
 * AIs con regla Módulo-10 GS1.
 * Cada entrada define la longitud total esperada del payload numérico.
 * GRAI (AI 8003): longitud variable — el prefijo es 14 dígitos con checksum;
 * el resto es referencia de activo (variable). Validamos solo los primeros 14.
 */
const GS1_MOD10_AI_LENGTHS: Record<string, number> = {
  "01":   14, // GTIN-14
  "8018": 18, // GSRN-18
  "00":   18, // SSCC-18
  "8003": 14, // GRAI — validamos los primeros 14 dígitos (prefijo + checksum)
};

/**
 * Calcula el dígito verificador Módulo-10 GS1 para un string de dígitos (sin el check digit).
 * Posiciones desde la derecha: posición impar × 3, posición par × 1.
 * Idéntico al algoritmo en gs1Mod10CheckDigit exportado arriba; re-expuesto aquí
 * para uso local sin dependencia circular.
 */
function mod10CheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = Number.parseInt(digits.charAt(i), 10);
    const fromRight = digits.length - i; // 1-based desde la derecha
    sum += fromRight % 2 === 0 ? d : d * 3;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

/**
 * Valida el checksum de un Application Identifier GS1.
 *
 * Soporta:
 *  - AI "01"   → GTIN-14 (14 dígitos totales)
 *  - AI "8018" → GSRN-18 (18 dígitos totales)
 *  - AI "00"   → SSCC-18 (18 dígitos totales)
 *  - AI "8003" → GRAI (valida los primeros 14 dígitos del payload)
 *
 * @param ai     - Application Identifier como string ("01", "8018", "00", "8003")
 * @param value  - payload numérico completo (sin el AI, con el check digit incluido)
 * @returns      - true si el checksum es correcto, false en caso contrario
 */
export function validateGS1Checksum(ai: string, value: string): boolean {
  const expectedTotalLen = GS1_MOD10_AI_LENGTHS[ai];
  if (expectedTotalLen === undefined) {
    // AI no soportado — no validamos
    return false;
  }

  // Extraer la porción numérica a validar (para GRAI son los primeros 14)
  const numeric = value.replace(/\D/g, "");

  // La longitud mínima debe ser al menos expectedTotalLen para los AIs de longitud fija
  if (numeric.length < expectedTotalLen) return false;

  // Para GRAI (8003): los primeros 14 dígitos son el segmento con checksum
  const segment = numeric.slice(0, expectedTotalLen);

  const body      = segment.slice(0, segment.length - 1);
  const checkChar = segment.charAt(segment.length - 1);
  const check     = Number.parseInt(checkChar, 10);

  if (Number.isNaN(check)) return false;

  return mod10CheckDigit(body) === check;
}

// =============================================================================
// HI-08 (audit Stream I) — Validador genérico Módulo-10 para AIs GS1 fijos
// =============================================================================

/**
 * Valida el dígito verificador GS1 Módulo-10 sobre un string numérico cuyo
 * último carácter es el check digit. Funciona para cualquier longitud:
 *
 *   - GTIN-14  (AI 01)
 *   - GLN-13   (sin AI explícito; muelle/proveedor)
 *   - SSCC-18  (AI 00)
 *   - GSRN-18  (AI 8018)
 *   - GRAI-14  (prefijo de AI 8003)
 *
 * Algoritmo (GS1 General Specifications v23 §7.9.1):
 *   "Multiplicar cada dígito alternadamente por 1 ó 3 empezando por el dígito
 *    más a la derecha del payload y asignando factor 3 al primero (rightmost)."
 *
 * Implementación: posición desde la derecha del body 1-based (1, 2, 3, …);
 * impar → ×3, par → ×1. El último dígito del input es el check digit esperado:
 *   `expected = (10 - (sum % 10)) % 10`.
 *
 * Para validación AI-specific con longitud fija, prefiere `validateGS1Checksum(ai, value)`.
 */
export function gs1CheckDigitValid(code: string): boolean {
  if (typeof code !== "string" || code.length < 2) return false;
  if (!/^\d+$/.test(code)) return false;
  const len = code.length;
  let sum = 0;
  for (let i = 0; i < len - 1; i++) {
    // posición desde la derecha del body (último dígito del body es pos 1)
    const fromRight = len - 1 - i;
    sum += fromRight % 2 === 1 ? Number.parseInt(code.charAt(i), 10) * 3 : Number.parseInt(code.charAt(i), 10);
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number.parseInt(code.charAt(len - 1), 10);
}

// =============================================================================
// CC-0029 — AI 8004 (GIAI, Global Individual Asset Identifier)
//
// A diferencia de GTIN/SSCC/GSRN/GRAI, el GIAI NO lleva dígito verificador
// (GS1 General Specifications §"AI 8004" — longitud y check digit quedan a
// discreción del emisor). Estructura usada aquí: prefijo GS1 de empresa
// (numérico, 7-12 dígitos, igual rango que Organization.gs1CompanyPrefix) +
// referencia de activo alfanumérica (1-23 caracteres), total ≤30 caracteres
// — mismo tope que define GS1 para el AI. Por eso vive en su propia sección
// en vez de sumarse a `GS1_MOD10_AI_LENGTHS`/`validateGS1Checksum` (esas son
// específicas de AIs con Módulo-10).
// =============================================================================

const GIAI_MAX_LENGTH = 30;
const GIAI_REGEX = /^\d{7,12}[A-Za-z0-9]{1,23}$/;

/**
 * Valida la estructura de un GIAI (AI 8004): prefijo GS1 numérico (7-12
 * dígitos) + referencia de activo alfanumérica, longitud total ≤30
 * caracteres. Sin dígito verificador — GS1 no lo exige para este AI.
 */
export function validateGIAI(value: string | null | undefined): boolean {
  if (!value) return false;
  const clean = value.trim();
  return clean.length <= GIAI_MAX_LENGTH && GIAI_REGEX.test(clean);
}

/**
 * Genera un GIAI determinista: prefijo GS1 de empresa + referencia de activo
 * derivada de un identificador propio (p.ej. `assetTag`). Sanea la
 * referencia a alfanumérico y la trunca para respetar el tope de 30
 * caracteres totales — la unicidad la garantiza que el identificador de
 * origen ya sea único dentro de su ámbito (p.ej. `assetTag` es único por
 * organización) combinado con el prefijo GS1, que también es propio de cada
 * organización.
 *
 * @param companyPrefix - prefijo GS1 de la empresa (7-12 dígitos)
 * @param assetReference - identificador de origen del activo (se sanea)
 * @throws si companyPrefix no es numérico de 7-12 dígitos, o si no queda
 *   ningún carácter alfanumérico utilizable en assetReference
 */
export function buildGIAI(companyPrefix: string, assetReference: string): string {
  if (!/^\d{7,12}$/.test(companyPrefix)) {
    throw new Error(
      `companyPrefix debe tener entre 7 y 12 dígitos numéricos (recibido: "${companyPrefix}")`,
    );
  }
  const clean = assetReference.replace(/[^0-9A-Za-z]/g, "");
  if (clean.length === 0) {
    throw new Error("assetReference no contiene caracteres alfanuméricos utilizables.");
  }
  const maxRefLength = GIAI_MAX_LENGTH - companyPrefix.length;
  const giai = companyPrefix + clean.slice(0, maxRefLength);
  if (!validateGIAI(giai)) {
    // Defensivo — no debería ocurrir dado el saneo/truncado anteriores.
    throw new Error("GIAI generado no pasó validación estructural.");
  }
  return giai;
}
