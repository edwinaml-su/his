/**
 * @his/contracts/schemas/password — política de contraseñas Avante.
 *
 * US-2.10 — Política configurable de contraseñas y cuenta.
 *
 * Política Avante (MVP, hardcoded):
 *   - MIN_LENGTH        = 12
 *   - REQUIRE_UPPERCASE = true
 *   - REQUIRE_LOWERCASE = true
 *   - REQUIRE_DIGIT     = true
 *   - REQUIRE_SYMBOL    = true (cualquier carácter ASCII no alfanumérico)
 *   - MAX_HISTORY       = 5  (no reusar las últimas 5 contraseñas)
 *   - EXPIRATION_DAYS   = 90
 *
 * Estos valores viven aquí como constantes para que los validadores se puedan
 * usar de forma idéntica en signup, change-password y reset-password sin que
 * haya divergencia accidental. El `passwordPolicySchema` deja el contrato
 * listo para hidratarse desde una tabla `PasswordPolicy` parametrizable por
 * país / organización en Sprint 2.
 *
 * Mensajes en es-SV (Avante El Salvador). Cuando expandamos a otros países
 * con i18n real (Sprint 2+), estas strings se moverán a `@his/i18n` y este
 * archivo expondrá keys en lugar de literales.
 */
import { z } from "zod";

// ---- Constantes de política Avante (MVP) ----------------------------------
// TODO(Sprint 2): mover a tabla `PasswordPolicy` parametrizable por
// país / organización. El `passwordPolicySchema` ya define el contrato.

export const MIN_LENGTH = 12;
export const REQUIRE_UPPERCASE = true;
export const REQUIRE_LOWERCASE = true;
export const REQUIRE_DIGIT = true;
export const REQUIRE_SYMBOL = true;
export const MAX_HISTORY = 5;
export const EXPIRATION_DAYS = 90;

/**
 * Bonus de longitud (>16 chars) usado por `estimateStrength`. Definido como
 * constante para que tests y UI puedan referenciarlo sin números mágicos.
 */
export const LENGTH_BONUS_THRESHOLD = 16;

// ---- Regex de clases de caracteres ----------------------------------------
// Símbolo = cualquier ASCII no alfanumérico (incluye espacio, puntuación,
// símbolos matemáticos, etc.). El rango \x21-\x7E cubre todos los imprimibles
// ASCII excepto el espacio; añadimos explícitamente el espacio para coincidir
// con la definición "ASCII no alfanumérico" del DoR.

const RE_UPPERCASE = /[A-Z]/;
const RE_LOWERCASE = /[a-z]/;
const RE_DIGIT = /[0-9]/;
// eslint-disable-next-line no-control-regex
const RE_SYMBOL = /[^A-Za-z0-9]/;

// ---- Schema de la política -------------------------------------------------

export const passwordPolicySchema = z.object({
  minLength: z.number().int().min(8),
  requireUppercase: z.boolean(),
  requireLowercase: z.boolean(),
  requireDigit: z.boolean(),
  requireSymbol: z.boolean(),
  /** Cantidad de contraseñas previas que NO se pueden reusar. */
  maxHistory: z.number().int().min(0),
  /** Vigencia en días; 0 = no expira. */
  expirationDays: z.number().int().min(0),
});

export type PasswordPolicy = z.infer<typeof passwordPolicySchema>;

/** Política Avante MVP — la usan los validadores cuando no se pasa otra. */
export const AVANTE_PASSWORD_POLICY: PasswordPolicy = {
  minLength: MIN_LENGTH,
  requireUppercase: REQUIRE_UPPERCASE,
  requireLowercase: REQUIRE_LOWERCASE,
  requireDigit: REQUIRE_DIGIT,
  requireSymbol: REQUIRE_SYMBOL,
  maxHistory: MAX_HISTORY,
  expirationDays: EXPIRATION_DAYS,
};

// ---- Helpers de clasificación ---------------------------------------------

/** Clases de caracteres presentes en `value`. Útil para strength score. */
export function characterClasses(value: string): {
  upper: boolean;
  lower: boolean;
  digit: boolean;
  symbol: boolean;
} {
  return {
    upper: RE_UPPERCASE.test(value),
    lower: RE_LOWERCASE.test(value),
    digit: RE_DIGIT.test(value),
    symbol: RE_SYMBOL.test(value),
  };
}

/** Cantidad de clases distintas presentes (0..4). */
export function characterClassCount(value: string): number {
  const c = characterClasses(value);
  return (
    (c.upper ? 1 : 0) +
    (c.lower ? 1 : 0) +
    (c.digit ? 1 : 0) +
    (c.symbol ? 1 : 0)
  );
}

// ---- Validador principal ---------------------------------------------------

export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4;

export type PasswordValidationResult = {
  valid: boolean;
  errors: string[];
  /** 0=very-weak, 1=weak, 2=ok, 3=strong, 4=excellent. */
  strengthScore: PasswordStrengthScore;
};

/**
 * Calcula el strength score [0..4]. Algoritmo:
 *   - Empezamos en 0.
 *   - +1 si longitud >= minLength.
 *   - +1 si hay >= 3 clases de caracteres distintas.
 *   - +1 si hay las 4 clases.
 *   - +1 bonus si longitud > LENGTH_BONUS_THRESHOLD (16).
 *   - Si el largo es < 8 forzamos 0 (very-weak), independientemente de clases.
 *
 * El score es ortogonal a `valid`: una password puede ser strong (3) pero
 * inválida si la política exige símbolo y solo hay 3 clases sin símbolo.
 */
export function estimateStrength(
  value: string,
  policy: PasswordPolicy = AVANTE_PASSWORD_POLICY,
): PasswordStrengthScore {
  if (value.length < 8) return 0;

  let score = 0;
  if (value.length >= policy.minLength) score += 1;

  const classes = characterClassCount(value);
  if (classes >= 3) score += 1;
  if (classes >= 4) score += 1;
  if (value.length > LENGTH_BONUS_THRESHOLD) score += 1;

  // Clamp defensivo (TS no infiere el rango de la suma).
  if (score < 0) return 0;
  if (score > 4) return 4;
  return score as PasswordStrengthScore;
}

/**
 * Valida `value` contra `policy`. Mensajes en es-SV.
 *
 * `valid` es true cuando `errors` está vacío. `strengthScore` se devuelve
 * siempre — la UI lo usa para alimentar el meter aunque la password sea
 * todavía inválida.
 */
export function validatePassword(
  value: string,
  policy: PasswordPolicy = AVANTE_PASSWORD_POLICY,
): PasswordValidationResult {
  const errors: string[] = [];
  const v = value ?? "";

  if (v.length < policy.minLength) {
    errors.push(`Mínimo ${policy.minLength} caracteres`);
  }

  const c = characterClasses(v);
  if (policy.requireUppercase && !c.upper) {
    errors.push("Falta una mayúscula");
  }
  if (policy.requireLowercase && !c.lower) {
    errors.push("Falta una minúscula");
  }
  if (policy.requireDigit && !c.digit) {
    errors.push("Incluye al menos un número");
  }
  if (policy.requireSymbol && !c.symbol) {
    errors.push("Incluye un carácter especial");
  }

  return {
    valid: errors.length === 0,
    errors,
    strengthScore: estimateStrength(v, policy),
  };
}

// ---- Schema Zod reutilizable (signup / change-password) -------------------

/**
 * Schema Zod estricto para la contraseña en signup / change-password.
 * Usa `superRefine` para emitir un issue por cada regla incumplida; así el
 * caller (form, server action) recibe la lista completa en un solo pase.
 *
 * NOTE: este schema NO se usa en el login form — ahí queremos ser laxos para
 * no romper cuentas pre-existentes a la política. Ver
 * `@his/contracts/schemas/auth#LOGIN_PASSWORD_MIN_LENGTH`.
 */
export const strongPasswordSchema = z.string().superRefine((value, ctx) => {
  const result = validatePassword(value);
  for (const message of result.errors) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});

/**
 * Schema completo de "cambio de contraseña" — útil cuando implementemos la
 * pantalla en Sprint 2. La validación de historial (no reusar últimas N) se
 * hace server-side contra la BD; aquí solo declaramos la forma del payload.
 */
export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1, "Ingresa tu contraseña actual"),
    newPassword: strongPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
  });

export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
