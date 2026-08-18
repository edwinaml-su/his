/**
 * Contexto tRPC. La app web pasa ya resuelta la sesión + tenant.
 * - `user`     → Supabase user mapeado a User local (puede ser null si anónimo).
 * - `tenant`   → TenantContext si la sesión tiene organización seleccionada.
 * - `prisma`   → cliente Prisma singleton.
 *
 * Ver `apps/web/src/lib/trpc/server.ts` para la integración Next.js.
 */
import type { TenantContext } from "@his/contracts";
import { prisma } from "@his/database";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
}

/** Contexto de un paciente autenticado en el Portal del Paciente (Beta.20). */
export interface PortalAccountContext {
  id: string;
  patientId: string;
  email: string;
}

export interface TRPCContext {
  prisma: typeof prisma;
  user: SessionUser | null;
  tenant: TenantContext | null;
  /** Contexto de portal (null fuera del portal). */
  portalAccount: PortalAccountContext | null;
  /** IP / UA opcional para auditoría. */
  ip?: string;
  userAgent?: string;
  /**
   * OWASP A07:2025 — ¿la sesión satisface la política de MFA?
   * Lo resuelve la capa web (`apps/web/src/lib/auth/mfa-session.ts`), que es
   * quien ve la cookie firmada. `undefined` = política apagada o llamador que
   * no la evalúa (server actions internas) → `tenantProcedure` no bloquea.
   */
  mfaSatisfied?: boolean;
  /**
   * CC-0017 — roles efectivos (directos ∪ herencia ∪ alias) resueltos por
   * `requireRole`/`requirePermission`. Ausente hasta que uno de esos dos
   * middlewares corre; NO reemplaza `tenant.roleCodes` (que sigue siendo la
   * selección directa del usuario, usada para lógica de negocio/auditoría).
   */
  effectiveRoleCodes?: string[];
  /** CC-0017 — permisos efectivos resueltos por `requirePermission`. */
  effectivePermissions?: Map<string, "ALLOW" | "DENY">;
}

export interface CreateContextInput {
  user: SessionUser | null;
  tenant: TenantContext | null;
  portalAccount?: PortalAccountContext | null;
  ip?: string;
  userAgent?: string;
  /** Ver `TRPCContext.mfaSatisfied`. */
  mfaSatisfied?: boolean;
}

export function createTRPCContext(input: CreateContextInput): TRPCContext {
  return {
    prisma,
    user: input.user,
    tenant: input.tenant,
    portalAccount: input.portalAccount ?? null,
    ip: input.ip,
    userAgent: input.userAgent,
    mfaSatisfied: input.mfaSatisfied,
  };
}
