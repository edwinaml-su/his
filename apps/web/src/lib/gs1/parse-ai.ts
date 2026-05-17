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
  let input = raw.replace(/^\]d2|^\]C1|^\]e0/i, "");

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
