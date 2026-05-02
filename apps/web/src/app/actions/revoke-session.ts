"use server";

/**
 * Server Action — revocación de sesiones (US-2.6).
 *
 * STUB Sprint 1.
 *
 * En MVP exponemos la firma definitiva (`revokeAllSessions(userId)`) para
 * que el panel admin del Sprint 2 pueda integrarse sin cambios de API,
 * pero la implementación real queda diferida:
 *
 *   - Sprint 1 (este): `console.warn` + retornar éxito sintético. Esto
 *     permite cablear UI admin y tests sin tocar Supabase Admin API.
 *   - Sprint 2: usar `supabase.auth.admin.signOut(userId, scope: "global")`
 *     desde un cliente service-role server-side, registrar en tabla de
 *     auditoría y validar que el caller tiene rol admin.
 *
 * SEGURIDAD:
 *   - Hoy NO hace check de autorización. NO conectar a UI sin antes
 *     resolver el TODO de Sprint 2. La función es defensiva (sólo log)
 *     pero exponerla en producción tal cual es ruido a auditoría.
 *
 * Por qué Server Action y no tRPC:
 *   - Sigue el mismo patrón que `login-policy.ts` para acciones de
 *     auth/seguridad que no encajan en el grafo tRPC del cliente.
 */

import { z } from "zod";

/**
 * Validación local del input. Idealmente importaríamos
 * `revokeAllSessionsInputSchema` desde `@his/contracts/schemas/session`,
 * pero el barrel `packages/contracts/src/schemas/index.ts` se actualiza
 * en otro entregable de este sprint; mientras tanto re-declaramos la
 * forma aquí. La fuente de verdad sigue siendo el schema en contracts.
 */
const revokeAllSessionsInputSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export type RevokeAllSessionsResult = {
  ok: boolean;
  /** Mensaje informativo — Sprint 1 siempre devuelve el aviso de stub. */
  message: string;
};

/**
 * Cierra todas las sesiones activas del usuario `userId`.
 *
 * STUB: Sprint 1 sólo registra la intención en consola del servidor.
 * No revoca nada en Supabase. Devuelve `{ ok: true }` para que la UI
 * pueda probarse de extremo a extremo.
 */
export async function revokeAllSessions(
  userId: string,
  reason?: string,
): Promise<RevokeAllSessionsResult> {
  // Validación de input — defensa en profundidad aunque venga de UI tipada.
  const parsed = revokeAllSessionsInputSchema.safeParse({ userId, reason });
  if (!parsed.success) {
    return {
      ok: false,
      message: `Input inválido: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  }

  // TODO(Sprint 2):
  //   1. const supabaseAdmin = createSupabaseAdminClient();
  //   2. await supabaseAdmin.auth.admin.signOut(parsed.data.userId, "global");
  //   3. await prisma.sessionRevocation.create({ data: { ... } });
  //   4. Verificar que el caller tiene rol admin (vía getTenantContext).
  console.warn(
    "[revokeAllSessions] STUB Sprint 1 — no-op. " +
      `userId=${parsed.data.userId} reason=${parsed.data.reason ?? "(none)"}`,
  );

  return {
    ok: true,
    message: "Stub Sprint 1: la revocación real se implementa en Sprint 2.",
  };
}
