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
