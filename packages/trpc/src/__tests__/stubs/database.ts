/**
 * Stub de `@his/database` solo para tests de tRPC.
 * Los routers que importan `prisma` desde `@his/database` reciben este
 * `prisma` mockeable. Cada test concreto sobreescribe los métodos que
 * usa con `vitest-mock-extended` (mockDeep) o `vi.fn()`.
 *
 * Nota: este archivo SOLO se usa vía el alias en `vitest.config.ts`.
 *
 * Beta.15: re-exportamos `emitDomainEvent` del fuente real porque su
 * implementación es código TS puro (recibe `tx` del caller, no instancia
 * Prisma) y los tests necesitan que la validación Zod + el `tx.domainEvent.create`
 * se ejecuten para verificar payload shape.
 */
import type { PrismaClient } from "@prisma/client";

const prismaStub = {} as unknown as PrismaClient;

export const prisma = prismaStub;
export type { PrismaClient };

export { emitDomainEvent } from "../../../../database/src/outbox/emit";
export type {
  EmitDomainEventInput,
  EmitDomainEventTx,
} from "../../../../database/src/outbox/emit";
