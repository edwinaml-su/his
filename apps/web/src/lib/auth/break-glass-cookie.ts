/**
 * CC-0017 F3 — Parseo puro (sin I/O) de la cookie httpOnly `his.break_glass`.
 *
 * Extraído a un módulo propio, sin importar `next/headers`/`@his/database`/
 * Supabase, para que `parseBreakGlassCookie` sea testeable de forma aislada
 * (ver `__tests__/break-glass-cookie.test.ts`) y para que `session.ts`
 * (`getTenantContext`) lo consuma como la ÚNICA fuente de verdad de esta
 * cookie en el server.
 *
 * Constantes espejo de `packages/contracts/src/schemas/break-glass.ts`
 * (mismo patrón ya usado en `app/actions/break-glass.ts` y
 * `break-glass.router.ts`: la barrel de schemas está congelada desde
 * Sprint 1 y esos módulos no se importan cross-package). Si diverge,
 * prevalece el archivo de contracts.
 */
export const BREAK_GLASS_COOKIE_NAME = "his.break_glass";
export const BREAK_GLASS_TTL_SECONDS = 60 * 60; // 1 hora

export interface BreakGlassSession {
  patientId: string;
  justification: string;
  activatedAt: string;
  expiresAt: string;
}

/**
 * Fail-safe por diseño: CUALQUIER cookie ausente, con JSON corrupto, con
 * campos faltantes/mal tipados, o expirada → retorna `null` (equivalente a
 * "sin break-glass", el comportamiento de hoy). Solo una cookie
 * estructuralmente válida y vigente activa la elevación.
 */
export function parseBreakGlassCookie(
  raw: string | undefined,
  now: Date = new Date(),
): BreakGlassSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      patientId?: unknown;
      justification?: unknown;
      activatedAt?: unknown;
    };
    if (
      typeof parsed.patientId !== "string" ||
      !parsed.patientId ||
      typeof parsed.justification !== "string" ||
      !parsed.justification ||
      typeof parsed.activatedAt !== "string"
    ) {
      return null;
    }
    const activatedAt = new Date(parsed.activatedAt);
    if (Number.isNaN(activatedAt.getTime())) return null;
    const expiresAt = new Date(activatedAt.getTime() + BREAK_GLASS_TTL_SECONDS * 1000);
    if (expiresAt.getTime() <= now.getTime()) return null;

    return {
      patientId: parsed.patientId,
      justification: parsed.justification,
      activatedAt: activatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  } catch {
    return null;
  }
}
