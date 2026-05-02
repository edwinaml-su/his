/**
 * @his/contracts/schemas/session — schemas Zod de política de sesión.
 *
 * US-2.6 — Sesión segura con expiración y revocación.
 *
 * Sprint 1 (MVP):
 *   - `idleConfigSchema` describe la forma de configuración runtime que
 *     consume `<IdleMonitor>` (idleMinutes, warningMinutes). Hoy la app
 *     usa constantes hardcoded en `apps/web/src/lib/auth/session-policy.ts`,
 *     pero el schema ya está listo para hidratarse desde BD/tRPC en S2.
 *   - `revokeAllSessionsInputSchema` valida el input de la Server Action
 *     `revokeAllSessions` (stub Sprint 1, real en Sprint 2).
 *
 * NOTA: este archivo NO se re-exporta desde `schemas/index.ts` ni desde
 * `src/index.ts` en este sprint — esos barrels los mantiene otro agente
 * y los toca al final del sprint cuando consolida exports. Mientras tanto
 * los consumidores importan directo `@his/contracts/schemas/session`.
 */
import { z } from "zod";
import { uuid } from "./common";

/**
 * Configuración del IdleMonitor. Validación defensiva:
 *   - warningMinutes < idleMinutes (si no, el dialog nunca aparece).
 *   - ambos enteros positivos.
 *
 * En MVP sólo valida los dos campos esenciales; en Sprint 2 podemos añadir
 * `enabled`, `events`, `throttleMs` cuando los movamos a tabla.
 */
export const idleConfigSchema = z
  .object({
    /** Minutos sin actividad antes de cerrar sesión automáticamente. */
    idleMinutes: z.number().int().positive(),
    /** Minutos antes del logout en que aparece el dialog de aviso. */
    warningMinutes: z.number().int().positive(),
  })
  .refine((c) => c.warningMinutes < c.idleMinutes, {
    message: "warningMinutes debe ser menor que idleMinutes",
    path: ["warningMinutes"],
  });

/**
 * Input de `revokeAllSessions` — Server Action admin que cierra todas las
 * sesiones del usuario `userId` (stub Sprint 1).
 *
 * El campo `reason` es opcional pero recomendado: queda en audit log cuando
 * Sprint 2 conecte la implementación real con Supabase Admin API.
 */
export const revokeAllSessionsInputSchema = z.object({
  userId: uuid,
  reason: z.string().trim().min(1).max(500).optional(),
});

export type IdleConfig = z.infer<typeof idleConfigSchema>;
export type RevokeAllSessionsInput = z.infer<typeof revokeAllSessionsInputSchema>;
