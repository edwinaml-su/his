/**
 * withWorkflowContext — DEPRECADO (CC-0033 / hallazgo P0-2, auditoría
 * 2026-09-15). Este archivo era el stub "Stream 11" que no seteaba ningún GUC
 * de sesión ni demotaba el rol — ejecutaba el callback bajo el rol Postgres
 * con BYPASSRLS, es decir sin RLS real. Los 6 routers que lo usaban
 * (episodio, episodio-hospitalario, acto-quirurgico, cama, workflow-tipoDoc,
 * workflow-tipoDoc-override) ya migraron a la implementación REAL:
 * `packages/trpc/src/workflow/context.ts` (mismo `withWorkflowContext`, otra
 * firma — recibe un `EceContext` en vez de un `establecimientoId` suelto) o,
 * para routers que mezclan schemas `public.*`/`ece.*`, a `withEceContext`
 * (`packages/trpc/src/ece/rls-context.ts`).
 *
 * Este export ahora LANZA en vez de ser un no-op silencioso — un router
 * nuevo que importe este módulo por error debe fallar ruidosamente en tests/
 * runtime, no correr bajo BYPASSRLS sin que nadie lo note (precedente:
 * exactamente este stub estuvo así, sin ser detectado, hasta la auditoría).
 *
 * @see docs/audit/2026-09-15_cobertura/01-admision-emergencia-hosp-quirofano.md hallazgo B2/P0-2
 */
import type { PrismaClient } from "@his/database";

export async function withWorkflowContext<T>(
  _prisma: PrismaClient,
  _establecimientoId: string | undefined,
  _fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  throw new Error(
    "withWorkflowContext (ece/workflow-context.ts) está deprecado y ya no ejecuta el " +
      "callback (CC-0033 P0-2): no seteaba GUC ni demotaba el rol, corría bajo BYPASSRLS. " +
      "Usa withWorkflowContext de packages/trpc/src/workflow/context.ts (recibe un EceContext) " +
      "o withEceContext de packages/trpc/src/ece/rls-context.ts si el router mezcla schemas " +
      "public.*/ece.*.",
  );
}
