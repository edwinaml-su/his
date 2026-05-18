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
      const aiLen = ai3.startsWith("39") || ai3.startsWith("71") ? 3 : 2;
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
    // Otros AIs ignorados — extensible sin romper API.
  }
}
