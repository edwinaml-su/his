/**
 * US-2.7 — Break-glass: acceso de emergencia auditado.
 *
 * Modelo:
 *   Un médico (u otro rol clínico) sin permiso normal sobre un paciente puede
 *   "romper el cristal" para abrir su expediente en una emergencia. La acción:
 *     - Exige justificación textual (≥ 20 chars).
 *     - Setea cookie `his.break_glass` con TTL 1h y payload firmable.
 *     - Inserta entrada en `audit.AuditLog` action=BREAK_GLASS / severity HIGH.
 *     - Marca `notify_chief: true` en `afterJson` (Sprint 2 envía el email real).
 *
 * NOTA: estos schemas NO se re-exportan desde `schemas/index.ts` para no tocar
 * el barrel del paquete contracts. Consumidores los importan directo:
 *   import { breakGlassActivateInput } from ".../break-glass";
 */
import { z } from "zod";

/** Mínimo textual para forzar a que el médico justifique (no “xxxxx”). */
export const MIN_JUSTIFICATION_LEN = 20;
export const MAX_JUSTIFICATION_LEN = 1000;

/** Input de activación — usado por el Server Action y la mutation tRPC. */
export const breakGlassActivateInput = z.object({
  patientId: z.string().uuid({ message: "patientId debe ser UUID" }),
  justification: z
    .string()
    .trim()
    .min(MIN_JUSTIFICATION_LEN, `Justificación mínima ${MIN_JUSTIFICATION_LEN} caracteres`)
    .max(MAX_JUSTIFICATION_LEN),
  /** El usuario confirmó haber notificado al jefe de servicio (canal externo). */
  chiefNotifiedAck: z.boolean().refine((v) => v === true, {
    message: "Debe confirmar la notificación al jefe de servicio.",
  }),
});
export type BreakGlassActivateInput = z.infer<typeof breakGlassActivateInput>;

/**
 * Payload serializado a la cookie `his.break_glass`.
 * `activatedAt` en ISO-8601 para evitar problemas de superjson en cookies.
 */
export const breakGlassCookiePayload = z.object({
  patientId: z.string().uuid(),
  justification: z.string().min(MIN_JUSTIFICATION_LEN).max(MAX_JUSTIFICATION_LEN),
  activatedAt: z.string().datetime(),
});
export type BreakGlassCookiePayload = z.infer<typeof breakGlassCookiePayload>;

/** Respuesta de `current` — null si no hay sesión break-glass activa. */
export const breakGlassCurrentResponse = z
  .object({
    active: z.literal(true),
    patientId: z.string().uuid(),
    justification: z.string(),
    activatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .or(z.object({ active: z.literal(false) }));
export type BreakGlassCurrentResponse = z.infer<typeof breakGlassCurrentResponse>;

/** Constantes compartidas — TTL 1h alineado con SLA de notificación al jefe. */
export const BREAK_GLASS_COOKIE_NAME = "his.break_glass";
export const BREAK_GLASS_TTL_SECONDS = 60 * 60; // 1 hora
