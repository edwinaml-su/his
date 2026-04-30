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

export interface TRPCContext {
  prisma: typeof prisma;
  user: SessionUser | null;
  tenant: TenantContext | null;
  /** IP / UA opcional para auditoría. */
  ip?: string;
  userAgent?: string;
}

export interface CreateContextInput {
  user: SessionUser | null;
  tenant: TenantContext | null;
  ip?: string;
  userAgent?: string;
}

export function createTRPCContext(input: CreateContextInput): TRPCContext {
  return {
    prisma,
    user: input.user,
    tenant: input.tenant,
    ip: input.ip,
    userAgent: input.userAgent,
  };
}
