"use server";

/**
 * Server Actions — política de contraseñas (US-2.10).
 *
 * Dos endpoints "puros" (sin BD) que envuelven los validadores de
 * `@his/contracts/schemas/password` para que el cliente los pueda invocar
 * desde Server Components o desde un Client Component vía `useFormState` /
 * `useTransition`, sin tener que importar Zod en el bundle del navegador.
 *
 *   - `validatePassword(value)`         — devuelve { valid, errors, strengthScore }.
 *   - `estimatePasswordStrength(value)` — devuelve solo el score 0..4 (más barato
 *                                          si la UI solo necesita pintar el meter).
 *
 * Ambas son funciones server-side en Sprint 1 y Sprint 2. Cuando exista la
 * tabla `PasswordPolicy` parametrizable, este archivo será el único punto
 * donde se hidrata la policy desde la BD — el contrato de retorno se
 * mantiene estable.
 *
 * NOTE: aunque hoy las funciones son síncronas y podrían vivir en cliente,
 * las exponemos como Server Actions para que el cálculo de strength se haga
 * con la misma lógica que la futura validación contra historial (que sí
 * requiere BD). De este modo el form no cambia de API entre Sprint 1 y 2.
 */

import {
  validatePassword as validatePasswordPure,
  estimateStrength,
  type PasswordValidationResult,
  type PasswordStrengthScore,
} from "@his/contracts";

/**
 * Valida la contraseña contra la política Avante (MVP hardcoded).
 *
 * @param value — texto en claro tal cual lo escribió el usuario.
 * @returns { valid, errors[], strengthScore } — `errors` es lista en es-SV.
 */
export async function validatePassword(
  value: string,
): Promise<PasswordValidationResult> {
  return validatePasswordPure(value);
}

/**
 * Devuelve solo el strength score 0..4. Útil para alimentar el meter sin
 * tener que serializar la lista de errores en cada keystroke.
 */
export async function estimatePasswordStrength(
  value: string,
): Promise<PasswordStrengthScore> {
  return estimateStrength(value);
}
