/**
 * US-2.2 — MFA TOTP obligatorio para roles privilegiados.
 *
 * Schemas Zod compartidos entre Server Actions, router tRPC y forms cliente.
 *
 * Decisiones:
 *   - Token TOTP: 6 dígitos numéricos (RFC 6238 default). Aceptamos string
 *     para no perder ceros a la izquierda en el JSON / URL.
 *   - Backup codes: 10 códigos de 8 dígitos. Se entregan UNA SOLA VEZ al
 *     enrolar; el almacenamiento server cifra el set completo junto al
 *     secret en `UserCredential.secretHash` (paquete cifrado JSON).
 *   - El `userId` del verify es opcional en el input público porque el caller
 *     normal lo toma del contexto autenticado; lo dejamos en el schema para
 *     usos administrativos (admin verifica MFA de otro user — Sprint 2).
 *
 * NOTA: estos schemas NO se re-exportan desde `schemas/index.ts` para no
 * tocar el barrel en Sprint 1. Consumidores importan directo:
 *   import { totpVerifyInput } from "@his/contracts/schemas/mfa";
 *
 * Roles que requieren MFA en MVP — flag-list cerrada. Cuando exista
 * `MfaPolicy` parametrizable (Sprint 2) se moverá a tabla.
 */
import { z } from "zod";

// ---- Constantes de política MFA (MVP) -------------------------------------
// TODO(Sprint 2): mover a tabla `MfaPolicy` parametrizable por país /
// organización (mismo patrón que LoginPolicy / PasswordPolicy).

/** Roles que ESTÁN obligados a completar TOTP además de password. */
export const MFA_REQUIRED_ROLES = ["ADMIN", "PHYSICIAN"] as const;
export type MfaRequiredRole = (typeof MFA_REQUIRED_ROLES)[number];

/** Tolerancia de ventana TOTP: ±1 step (30s) = 90s de gracia total. */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_WINDOW = 1;
export const TOTP_DIGITS = 6;

/** Cantidad y largo de los backup codes entregados al enrolar. */
export const BACKUP_CODE_COUNT = 10;
export const BACKUP_CODE_LENGTH = 8;

/** Largo del secret base32 generado para nuevos enrolments. */
export const TOTP_SECRET_LENGTH = 32;

// ---- Helpers regex --------------------------------------------------------

const RE_TOTP_TOKEN = /^[0-9]{6}$/;
const RE_BACKUP_CODE = /^[0-9]{8}$/;
/** Base32 RFC 4648 (sin padding). Se permite minúsculas; el server normaliza. */
const RE_BASE32 = /^[A-Za-z2-7]+$/;

// ---- Schemas --------------------------------------------------------------

/**
 * Input para iniciar el enrolamiento. El usuario debe estar autenticado
 * (Server Action toma el userId del contexto Supabase). El payload va vacío
 * porque la generación del secret se hace server-side; mantenemos un objeto
 * por consistencia y para futuros campos (label, issuer override, etc.).
 */
export const totpEnrollInput = z.object({}).strict();
export type TotpEnrollInput = z.infer<typeof totpEnrollInput>;

/**
 * Output del enrolamiento. El secret + otpauth URI + backup codes se entregan
 * UNA SOLA VEZ; el cliente DEBE persistirlos antes de cerrar el modal.
 *   - `secret`: base32 sin padding, para escaneo manual cuando el QR falle.
 *   - `otpauthUri`: URI estándar `otpauth://totp/<issuer>:<account>?secret=...`.
 *   - `backupCodes`: 10 códigos en texto plano. Server guarda el cifrado.
 */
export const totpEnrollResult = z.object({
  secret: z.string().regex(RE_BASE32),
  otpauthUri: z.string().url().or(z.string().startsWith("otpauth://")),
  backupCodes: z.array(z.string().regex(RE_BACKUP_CODE)).length(BACKUP_CODE_COUNT),
});
export type TotpEnrollResult = z.infer<typeof totpEnrollResult>;

/**
 * Input de verificación. `token` es el código de 6 dígitos del authenticator
 * (o un backup code de 8 dígitos — el server distingue por largo).
 *
 * `userId` opcional — solo se usa en flujos admin. El server PUEDE ignorarlo
 * si difiere del usuario en sesión (defensa en profundidad).
 */
export const totpVerifyInput = z.object({
  userId: z.string().uuid().optional(),
  token: z
    .string()
    .trim()
    .refine((v) => RE_TOTP_TOKEN.test(v) || RE_BACKUP_CODE.test(v), {
      message: "Código inválido. Debe tener 6 u 8 dígitos.",
    }),
});
export type TotpVerifyInput = z.infer<typeof totpVerifyInput>;

/** Output de verify. `usedBackupCode` permite a la UI avisar al usuario. */
export const totpVerifyResult = z.object({
  ok: z.boolean(),
  usedBackupCode: z.boolean().optional(),
  /** Cuántos backup codes le quedan al usuario tras este consumo. */
  remainingBackupCodes: z.number().int().min(0).optional(),
});
export type TotpVerifyResult = z.infer<typeof totpVerifyResult>;

/**
 * Output de status — para que la página de cuenta sepa si MFA está activo
 * y cuándo se verificó por última vez (señal de "todo bien").
 */
export const totpStatusResult = z.object({
  enabled: z.boolean(),
  method: z.enum(["TOTP", "NONE"]),
  lastVerifiedAt: z.string().datetime().nullable(),
});
export type TotpStatusResult = z.infer<typeof totpStatusResult>;

/**
 * Helper: indica si un rol exige MFA bajo la política MVP. El consumidor
 * típico es el middleware de login y la página `/mfa`.
 */
export function isMfaRequiredForRole(roleCode: string): boolean {
  return (MFA_REQUIRED_ROLES as readonly string[]).includes(roleCode);
}
