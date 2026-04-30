/**
 * Fixtures DUI/NIT/NIE — matriz canónica de prueba.
 *
 * IMPORTANTE — paridad SQL ↔ TS:
 *   La generación se hace con la MISMA fórmula publicada en
 *   `packages/database/prisma/migrations/sql/03_validations_sv.sql`
 *   (validate_dui / validate_nit). Si alguna vez se modifica la fórmula
 *   en el SQL, este archivo debe actualizarse de inmediato y los tests
 *   de paridad fallarán hasta que coincidan.
 *
 * No se incluye PII real: los cuerpos numéricos son secuencias didácticas.
 */

// ─────────────────────────────────────────────────────────────────────────
// Cálculo del dígito verificador DUI (módulo 10 con pesos 9..2).
// Mantiene paridad bit a bit con `public.validate_dui` en PG.
// ─────────────────────────────────────────────────────────────────────────
export function computeDuiCheckDigit(body8: string): number {
  if (!/^[0-9]{8}$/.test(body8)) {
    throw new Error("DUI body debe tener exactamente 8 dígitos.");
  }
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number.parseInt(body8.charAt(i), 10) * (10 - (i + 1));
  }
  let calc = 10 - (sum % 10);
  if (calc === 10) calc = 0;
  return calc;
}

/** Devuelve un DUI con verificador válido a partir de los 8 primeros dígitos. */
export function makeValidDUI(body8: string): string {
  return `${body8}${computeDuiCheckDigit(body8)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// NIT (módulo 11 con pesos 14..2 sobre 13 dígitos).
// ─────────────────────────────────────────────────────────────────────────
export function computeNitCheckDigit(body13: string): number {
  if (!/^[0-9]{13}$/.test(body13)) {
    throw new Error("NIT body debe tener exactamente 13 dígitos.");
  }
  let sum = 0;
  for (let i = 1; i <= 13; i++) {
    const digit = Number.parseInt(body13.charAt(i - 1), 10);
    const weight = 15 - i;
    sum += digit * weight;
  }
  let calc = (sum * 10) % 11;
  if (calc === 10) calc = 0;
  if (calc === 11) calc = 1;
  return calc;
}

export function makeValidNIT(body13: string): string {
  return `${body13}${computeNitCheckDigit(body13)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// 20 cuerpos DUI canónicos → DUIs válidos generados.
// ─────────────────────────────────────────────────────────────────────────
const DUI_BODIES_8 = [
  "00000000",
  "00000001",
  "00000010",
  "00000100",
  "00001000",
  "00010000",
  "00100000",
  "01000000",
  "10000000",
  "12345678",
  "87654321",
  "11111111",
  "22222222",
  "33333333",
  "44444444",
  "55555555",
  "66666666",
  "77777777",
  "88888888",
  "99999999",
];

export const VALID_DUIS: ReadonlyArray<string> = DUI_BODIES_8.map(makeValidDUI);

// DUIs con guion, deben ser igualmente válidos por la normalización.
export const VALID_DUIS_WITH_DASH: ReadonlyArray<string> = VALID_DUIS.map(
  (d) => `${d.slice(0, 8)}-${d.slice(8)}`,
);

/**
 * DUIs inválidos por categoría — útiles para mostrar mensajes de error
 * específicos en UI/Zod superRefine.
 */
export const INVALID_DUIS = {
  empty: "",
  whitespace: "   ",
  tooShort: "12345678",         // 8 dígitos.
  tooLong: "1234567890123",     // 13 dígitos.
  letters: "1234567A8",         // contiene letra.
  // Cuerpo válido pero verificador alterado (genera un DUI inválido determinista).
  badCheck: (() => {
    const valid = makeValidDUI("12345678");
    const bad = (computeDuiCheckDigit("12345678") + 1) % 10;
    return `${valid.slice(0, 8)}${bad}`;
  })(),
} as const;

// ─────────────────────────────────────────────────────────────────────────
// 20 cuerpos NIT canónicos → NITs válidos.
// ─────────────────────────────────────────────────────────────────────────
const NIT_BODIES_13 = [
  "0000000000000",
  "0000000000001",
  "0614150390123",
  "0614150390124",
  "1234567890123",
  "9999999999999",
  "1111111111111",
  "2222222222222",
  "3333333333333",
  "4444444444444",
  "5555555555555",
  "6666666666666",
  "7777777777777",
  "8888888888888",
  "0101010101010",
  "1212121212121",
  "0606010198001",
  "0606010198002",
  "0606010198003",
  "0606010198004",
];

export const VALID_NITS: ReadonlyArray<string> = NIT_BODIES_13.map(makeValidNIT);

export const INVALID_NITS = {
  empty: "",
  tooShort: "06141503901234".slice(0, 12),
  tooLong: "06141503901234567",
  letters: "0614150390123A",
  badCheck: (() => {
    const valid = makeValidNIT("0614150390123");
    const bad = (computeNitCheckDigit("0614150390123") + 1) % 10;
    return `${valid.slice(0, 13)}${bad}`;
  })(),
} as const;

// ─────────────────────────────────────────────────────────────────────────
// NIE — estructura alfanumérica 9..14. Si son 14 dígitos → delega a NIT.
// ─────────────────────────────────────────────────────────────────────────
export const VALID_NIES: ReadonlyArray<string> = [
  "E12345678",            // 9 chars alfanumérico.
  "E1234567890",          // 11 chars.
  "E12345678901234".slice(0, 14),
  "EXTR123456",
  "ABC123XYZ",
  // NIE en formato 14 dígitos puros = NIT válido (delegación).
  makeValidNIT("0614150390123"),
];

export const INVALID_NIES = {
  empty: "",
  tooShort: "E1234567",            // 8 chars.
  tooLong: "E12345678901234567",   // > 14.
  // 14 dígitos puros pero verificador NIT inválido.
  badNumeric: (() => {
    const valid = makeValidNIT("0614150390123");
    const bad = (Number(valid.slice(13)) + 1) % 10;
    return `${valid.slice(0, 13)}${bad}`;
  })(),
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Matriz consolidada — la consume identifier.test.ts y mantiene la paridad SQL.
// Cada fila documenta la categoría para que el reporte de fallos sea legible.
// ─────────────────────────────────────────────────────────────────────────
export interface IdentifierFixture {
  kind: "DUI" | "NIT" | "NIE";
  value: string;
  expected: boolean;
  category: string;
}

export const IDENTIFIER_PARITY_MATRIX: ReadonlyArray<IdentifierFixture> = [
  ...VALID_DUIS.map((v) => ({ kind: "DUI" as const, value: v, expected: true, category: "DUI válido" })),
  ...VALID_DUIS_WITH_DASH.map((v) => ({ kind: "DUI" as const, value: v, expected: true, category: "DUI válido con guion" })),
  { kind: "DUI", value: INVALID_DUIS.empty, expected: false, category: "DUI vacío" },
  { kind: "DUI", value: INVALID_DUIS.whitespace, expected: false, category: "DUI espacios" },
  { kind: "DUI", value: INVALID_DUIS.tooShort, expected: false, category: "DUI corto" },
  { kind: "DUI", value: INVALID_DUIS.tooLong, expected: false, category: "DUI largo" },
  { kind: "DUI", value: INVALID_DUIS.letters, expected: false, category: "DUI con letras" },
  { kind: "DUI", value: INVALID_DUIS.badCheck, expected: false, category: "DUI verificador incorrecto" },

  ...VALID_NITS.map((v) => ({ kind: "NIT" as const, value: v, expected: true, category: "NIT válido" })),
  { kind: "NIT", value: INVALID_NITS.empty, expected: false, category: "NIT vacío" },
  { kind: "NIT", value: INVALID_NITS.tooShort, expected: false, category: "NIT corto" },
  { kind: "NIT", value: INVALID_NITS.tooLong, expected: false, category: "NIT largo" },
  { kind: "NIT", value: INVALID_NITS.letters, expected: false, category: "NIT con letras" },
  { kind: "NIT", value: INVALID_NITS.badCheck, expected: false, category: "NIT verificador incorrecto" },

  ...VALID_NIES.map((v) => ({ kind: "NIE" as const, value: v, expected: true, category: "NIE válido" })),
  { kind: "NIE", value: INVALID_NIES.empty, expected: false, category: "NIE vacío" },
  { kind: "NIE", value: INVALID_NIES.tooShort, expected: false, category: "NIE corto" },
  { kind: "NIE", value: INVALID_NIES.tooLong, expected: false, category: "NIE largo" },
  { kind: "NIE", value: INVALID_NIES.badNumeric, expected: false, category: "NIE 14 dígitos verificador NIT inválido" },
];
