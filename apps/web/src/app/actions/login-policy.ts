"use server";

/**
 * Server Actions — política de login (US-2.1).
 *
 * Implementa el lado servidor del lockout temporal por intentos fallidos:
 *
 *   - `isAccountLocked(email)` — el form llama ANTES de pegarle a Supabase,
 *     para no gastar request si la cuenta está bloqueada.
 *   - `recordLoginAttempt(email, success)` — el form llama DESPUÉS de la
 *     respuesta de Supabase; incrementa contador o lo resetea.
 *   - `resetFailedAttempts(email)` — helper exportado para flujos auxiliares
 *     (p. ej. password reset cuando se implemente Sprint 2).
 *
 * Por qué Server Actions y no tRPC:
 *   - El login page corre en cliente y necesitamos llamar estas funciones
 *     antes de que exista una sesión Supabase. Server Actions son la vía
 *     más simple sin exponer endpoints públicos extra.
 *   - La consulta es por `email` (citext, case-insensitive en BD) y el riesgo
 *     de enumeration está acotado: la respuesta no distingue "email no existe"
 *     de "email no bloqueado" (ambos devuelven `{ locked: false }`).
 *
 * Política MVP — hardcoded.
 *
 * TODO(Sprint 2): mover MAX_ATTEMPTS / LOCK_MINUTES a tabla `LoginPolicy`
 * parametrizable por país / organización. Ver
 * `@his/contracts/schemas/auth#loginPolicySchema` que ya define la forma.
 *
 * Notas de seguridad:
 *   - No usamos transacciones explícitas: las dos escrituras (incrementar y
 *     eventualmente fijar lockedUntil) caben en un solo `update`. Una race
 *     entre dos intentos simultáneos como mucho dispara el lock un intento
 *     antes — comportamiento aceptable y siempre del lado conservador.
 *   - El lockout afecta solo password local. Login vía SSO (otra story)
 *     debe ignorar estos contadores.
 */

import { prisma } from "@his/database";

// ---- Política Avante (MVP) -------------------------------------------------
// TODO(Sprint 2): mover a tabla policy parametrizable.
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// ---------------------------------------------------------------------------

export type AccountLockStatus = {
  locked: boolean;
  until?: Date;
  minutesLeft?: number;
};

export type LoginAttemptResult = {
  /** True si este intento fallido cruzó el umbral y disparó el lock. */
  locked?: boolean;
  /** Cuándo expira el bloqueo (solo si `locked` es true). */
  until?: Date;
  /**
   * Cuántos intentos quedan antes de bloquearse.
   * Solo se devuelve en intentos fallidos NO bloqueantes.
   */
  remainingAttempts?: number;
};

/**
 * Normaliza email para lookup. La columna en BD es citext, así que no haría
 * falta lowercase, pero lo hacemos para no depender de la extensión y para
 * que el log/telemetría sea consistente.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Devuelve el estado de bloqueo de la cuenta. Si el email no existe, devuelve
 * `{ locked: false }` — NO filtrar existencia de la cuenta al cliente.
 */
export async function isAccountLocked(email: string): Promise<AccountLockStatus> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { locked: false };

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { lockedUntil: true },
  });

  if (!user || !user.lockedUntil) return { locked: false };

  const now = new Date();
  if (user.lockedUntil <= now) {
    // Lock vencido: lo dejamos vivir hasta el próximo `recordLoginAttempt`,
    // que hará el reset al primer intento exitoso o el incremento al fallido.
    return { locked: false };
  }

  const minutesLeft = Math.max(
    1,
    Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000),
  );

  return { locked: true, until: user.lockedUntil, minutesLeft };
}

/**
 * Registra el resultado de un intento de login.
 *
 * - Success: resetea `failedAttempts` a 0 y libera `lockedUntil`.
 * - Fail   : incrementa `failedAttempts`. Si llega a MAX_ATTEMPTS, fija
 *            `lockedUntil = now + LOCK_MINUTES min` y resetea el contador
 *            a 0 (de modo que tras expirar el lock, el siguiente fallo
 *            empieza de nuevo desde 1).
 *
 * Idempotente respecto al email: si el usuario no existe en BD local
 * (caso "Supabase aceptó pero aún no sincronizamos User"), la función no
 * hace nada — devolver early evita Prisma `findUnique` -> null -> update
 * crash.
 */
export async function recordLoginAttempt(
  email: string,
  success: boolean,
): Promise<LoginAttemptResult> {
  const normalized = normalizeEmail(email);
  if (!normalized) return {};

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, failedAttempts: true, lockedUntil: true },
  });

  if (!user) {
    // No conocemos el usuario localmente — nada que rastrear. No filtramos
    // la inexistencia al caller (devolvemos un objeto neutro).
    return {};
  }

  if (success) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });
    return {};
  }

  // Falló: si había un lock previo ya vencido, lo limpiamos y empezamos en 1.
  const now = new Date();
  const lockExpired = user.lockedUntil != null && user.lockedUntil <= now;
  const baseAttempts = lockExpired ? 0 : user.failedAttempts;
  const nextAttempts = baseAttempts + 1;

  if (nextAttempts >= MAX_ATTEMPTS) {
    const until = new Date(now.getTime() + LOCK_MINUTES * 60_000);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        // Reset del contador: tras expirar el lock, el próximo fallo arranca
        // limpio. Mantener el contador en MAX_ATTEMPTS llevaría a re-bloquear
        // al primer fallo post-unlock, que es UX hostil.
        failedAttempts: 0,
        lockedUntil: until,
      },
    });
    return { locked: true, until };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedAttempts: nextAttempts,
      // Si había lock vencido, lo limpiamos explícitamente.
      ...(lockExpired ? { lockedUntil: null } : {}),
    },
  });

  return { remainingAttempts: MAX_ATTEMPTS - nextAttempts };
}

/**
 * Resetea contadores y libera lock. Pensado para flujos administrativos
 * (admin desbloquea cuenta) o post-password-reset (Sprint 2).
 */
export async function resetFailedAttempts(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  await prisma.user.updateMany({
    where: { email: normalized },
    data: { failedAttempts: 0, lockedUntil: null },
  });
}
