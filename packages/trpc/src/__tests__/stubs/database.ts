/**
 * Stub de `@his/database` solo para tests de tRPC.
 * Los routers que importan `prisma` desde `@his/database` reciben este
 * `prisma` mockeable. Cada test concreto sobreescribe los métodos que
 * usa con `vitest-mock-extended` (mockDeep) o `vi.fn()`.
 *
 * Nota: este archivo SOLO se usa vía el alias en `vitest.config.ts`.
 *
 * Beta.15: `emitDomainEvent` se implementa aquí directamente (no importando
 * emit.ts real) para evitar el ciclo ESM que `emit.ts` introduce via
 * `@his/contracts/events` barrel. La implementación stub persiste en
 * `tx.domainEvent.create` igual que la real — los tests verifican el payload.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

const prismaStub = {} as unknown as PrismaClient;

export const prisma = prismaStub;
export type { PrismaClient };
// Re-exportamos el namespace `Prisma` del cliente real para que routers que
// usan `Prisma.sql\`...\`` template literal (workflow-tipoDoc, etc.) lo
// encuentren resuelto en tests via el alias del vitest.config.
export { Prisma };

// ---------------------------------------------------------------------------
// emitDomainEvent — implementación stub sin ciclo ESM de @his/contracts/events.
// ---------------------------------------------------------------------------

export interface EmitDomainEventInput {
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  emittedById: string;
  payload: unknown;
  correlationId?: string | null;
}

// El tipo `tx` es el PrismaClient (o TransactionClient) pasado por el caller.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EmitDomainEventTx = any;

/**
 * Implementación stub: valida que `tx.domainEvent.create` exista y lo llama.
 * Los tests de farmacia verifican el payload a través del mock de `prisma.domainEvent.create`.
 */
export async function emitDomainEvent(
  tx: EmitDomainEventTx,
  input: EmitDomainEventInput,
): Promise<void> {
  await tx.domainEvent.create({
    data: {
      organizationId: input.organizationId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      emittedById: input.emittedById,
      payload: input.payload,
      correlationId: input.correlationId ?? null,
    },
  });
}
