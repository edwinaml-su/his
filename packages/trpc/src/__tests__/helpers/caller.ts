/**
 * Helper para invocar routers tRPC con un contexto controlado.
 *
 * Cada test crea su propio `prisma` mock (mockDeep<PrismaClient>) y se lo
 * pasa al `createCaller` de cada router. Esto evita la complejidad de
 * mockear el módulo `@his/database` global por test.
 */
import type { PrismaClient } from "@prisma/client";
import type { TRPCContext } from "../../context";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";
import type { TenantContext } from "@his/contracts";
import type { SessionUser, PortalAccountContext } from "../../context";

export function makeCtx(overrides: {
  prisma?: Partial<PrismaClient>;
  user?: SessionUser | null;
  tenant?: TenantContext | null;
  portalAccount?: PortalAccountContext | null;
} = {}): TRPCContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: (overrides.prisma ?? {}) as any,
    user: overrides.user === undefined ? MOCK_USER_ADMIN : overrides.user,
    tenant: overrides.tenant === undefined ? MOCK_TENANT : overrides.tenant,
    portalAccount: overrides.portalAccount ?? null,
  };
}
