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
  ip?: string;
} = {}): TRPCContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: (overrides.prisma ?? {}) as any,
    user: overrides.user === undefined ? MOCK_USER_ADMIN : overrides.user,
    tenant: overrides.tenant === undefined ? MOCK_TENANT : overrides.tenant,
    portalAccount: overrides.portalAccount ?? null,
    ip: overrides.ip,
  };
}

/**
 * Instala un mock STATEFUL de `prisma.rateLimitHit` sobre un mock prisma
 * (mockDeep) para que el rate-limiter compartido (Postgres) funcione en tests
 * de routers que ejercitan brute-force. Sin esto, `mockDeep` devuelve
 * `undefined` en `count()` y el límite nunca dispara.
 *
 * Reemplaza al antiguo `_resetRateLimitForTesting()` del rate-limiter in-memory.
 * Llamar en `beforeEach` con el prisma mock fresco del test.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installRateLimitMock(prisma: any): void {
  const rows: { bucketKey: string; occurredAt: Date }[] = [];
  prisma.rateLimitHit = {
    count: async ({ where }: { where: { bucketKey: string; occurredAt: { gte: Date } } }) =>
      rows.filter((r) => r.bucketKey === where.bucketKey && r.occurredAt >= where.occurredAt.gte)
        .length,
    findFirst: async ({
      where,
    }: {
      where: { bucketKey: string; occurredAt: { gte: Date } };
    }) => {
      const matches = rows
        .filter((r) => r.bucketKey === where.bucketKey && r.occurredAt >= where.occurredAt.gte)
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      return matches[0] ? { occurredAt: matches[0].occurredAt } : null;
    },
    create: async ({ data }: { data: { bucketKey: string } }) => {
      rows.push({ bucketKey: data.bucketKey, occurredAt: new Date() });
      return undefined;
    },
  };
}
