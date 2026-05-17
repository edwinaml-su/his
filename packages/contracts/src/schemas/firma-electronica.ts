/**
 * Firma Electrónica Simple — Schemas Zod compartidos.
 *
 * Consumidores importan directo:
 *   import { setupPinSchema } from "@his/contracts/schemas/firma-electronica";
 *
 * Sin lógica de negocio — solo validación de bordes.
 */
import { z } from "zod";

// ---- Constantes de política PIN -------------------------------------------

const PIN_MIN = 6;
const PIN_MAX = 12;

const pinField = z.string().min(PIN_MIN).max(PIN_MAX);

// ---- Schemas --------------------------------------------------------------

/**
 * Configuración inicial de PIN de firma. Ambos campos deben coincidir.
 */
export const setupPinSchema = z
  .object({
    pin: pinField,
    confirmPin: pinField,
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: "Los PINs no coinciden.",
    path: ["confirmPin"],
  });
export type SetupPinInput = z.infer<typeof setupPinSchema>;

/**
 * Verificación de PIN para firmar un recurso/acción específicos.
 * `contextResource` y `contextAction` son opcionales para trazabilidad de auditoría.
 */
export const verifyPinSchema = z.object({
  pin: pinField,
  contextResource: z.string().optional(),
  contextAction: z.string().optional(),
});
export type VerifyPinInput = z.infer<typeof verifyPinSchema>;

/**
 * Resultado de una firma aplicada. `cached` indica si se reutilizó una firma
 * en ventana de tiempo (evita re-solicitar PIN en acciones consecutivas).
 */
export const firmaResultSchema = z.object({
  firmaId: z.string().uuid(),
  hash: z.string(),
  timestamp: z.string().datetime(),
  cached: z.boolean(),
});
export type FirmaResult = z.infer<typeof firmaResultSchema>;

/**
 * Solicitud de recuperación de PIN vía email.
 * `mfaCode` requerido para roles que tienen TOTP activo.
 */
export const recoveryRequestSchema = z.object({
  email: z.string().email(),
  mfaCode: z.string().optional(),
});
export type RecoveryRequestInput = z.infer<typeof recoveryRequestSchema>;
