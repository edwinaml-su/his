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
}

export interface CreateContextInput {
  user: SessionUser | null;
  tenant: TenantContext | null;
  portalAccount?: PortalAccountContext | null;
  ip?: string;
  userAgent?: string;
}

export function createTRPCContext(input: CreateContextInput): TRPCContext {
  return {
    prisma,
    user: input.user,
    tenant: input.tenant,
    portalAccount: input.portalAccount ?? null,
    ip: input.ip,
    userAgent: input.userAgent,
  };
}
