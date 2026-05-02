/**
 * @his/contracts/schemas/auth — schemas Zod para flujo de autenticación.
 *
 * US-2.1 — Login email + contraseña con políticas.
 *
 * Política Avante (MVP, hardcoded):
 *   - Longitud mínima password: 12 chars (en signup; aquí solo validamos
 *     el mínimo de 8 que exige Supabase para no romper logins legacy).
 *   - Bloqueo: N=5 intentos fallidos => lock 15 minutos.
 *
 * TODO(Sprint 2): introducir tabla `LoginPolicy` parametrizable por país /
 * organización (longitud, complejidad regex, expiración días, historial N
 * passwords previos). Este schema queda listo para hidratarse desde la BD
 * en lugar de constantes.
 */
import { z } from "zod";

/** Mínimo Avante para signup / cambio de contraseña. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Mínimo absoluto que aceptamos en el login form.
 *
 * Es deliberadamente más laxo que PASSWORD_MIN_LENGTH: en login solo nos
 * interesa que la entrada no sea trivial; la validación estricta de
 * complejidad sucede en signup / change-password (otra story Sprint 2).
 * Bajar aquí a 12 rompería logins de cuentas pre-existentes a la política.
 */
export const LOGIN_PASSWORD_MIN_LENGTH = 8;

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(LOGIN_PASSWORD_MIN_LENGTH),
});

export const loginPolicySchema = z.object({
  /** Intentos fallidos consecutivos antes del bloqueo temporal. */
  maxAttempts: z.number().int().positive(),
  /** Duración del bloqueo en minutos. */
  lockMinutes: z.number().int().positive(),
  /** Longitud mínima en signup / change-password. */
  passwordMinLength: z.number().int().min(8),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
export type LoginPolicy = z.infer<typeof loginPolicySchema>;
