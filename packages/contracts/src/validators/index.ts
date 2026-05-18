/**
 * Validadores de identificadores de El Salvador (TDR §27.3).
 * Mantienen paridad lógica con `03_validations_sv.sql` (validate_dui/nit/nie).
 */

/** Quita todo lo no numérico. */
const onlyDigits = (s: string): string => s.replace(/\D/g, "");

/**
 * DUI: 9 dígitos + verificador (10 - sum % 10), donde la suma se calcula
 * con pesos 9..2 sobre los primeros 8 dígitos. Si el cálculo da 10 → 0.
 * Acepta con o sin guion.
 */
export function validateDUI(input: string | null | undefined): boolean {
  if (!input) return false;
  const clean = onlyDigits(input);
  if (clean.length !== 9) return false;
  const body = clean.slice(0, 8);
  const check = Number.parseInt(clean.charAt(8), 10);
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number.parseInt(body.charAt(i), 10) * (10 - (i + 1));
  }
  let calc = 10 - (sum % 10);
  if (calc === 10) calc = 0;
  return calc === check;
}

/**
 * NIT: 14 dígitos. Verificador con pesos (15 - i) para i=1..13, módulo 11.
 * Si r=10 → 0; si r=11 → 1.
 */
export function validateNIT(input: string | null | undefined): boolean {
  if (!input) return false;
  const clean = onlyDigits(input);
  if (clean.length !== 14) return false;
  const body = clean.slice(0, 13);
  const check = Number.parseInt(clean.charAt(13), 10);
  let sum = 0;
  for (let i = 1; i <= 13; i++) {
    const digit = Number.parseInt(body.charAt(i - 1), 10);
    const weight = 15 - i;
    sum += digit * weight;
  }
  let calc = (sum * 10) % 11;
  if (calc === 10) calc = 0;
  if (calc === 11) calc = 1;
  return calc === check;
}

/**
 * NIE: 9–14 caracteres alfanuméricos.
 * Si son 14 dígitos exactos, delega en validateNIT (norma cerrada).
 * Si tiene letras: validación estructural ([A-Z0-9]{9,14}).
 */
export function validateNIE(input: string | null | undefined): boolean {
  if (!input) return false;
  const clean = input.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (clean.length < 9 || clean.length > 14) return false;
  if (/^[0-9]+$/.test(clean) && clean.length === 14) {
    return validateNIT(clean);
  }
  return /^[A-Z0-9]{9,14}$/.test(clean);
}

/** Despacha por kind del PatientIdentifier. */
export function validateIdentifier(
  kind: "DUI" | "NIT" | "NIE" | string,
  value: string,
): boolean {
  switch (kind) {
    case "DUI":
      return validateDUI(value);
    case "NIT":
      return validateNIT(value);
    case "NIE":
      return validateNIE(value);
    default:
      // Otros tipos (PASSPORT, MINOR_ID, ...) se validan estructuralmente.
      return typeof value === "string" && value.trim().length > 0;
  }
}

export * from "./gs1";
