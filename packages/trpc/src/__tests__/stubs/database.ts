/**
 * Stub de `@his/database` solo para tests de tRPC.
 * Los routers que importan `prisma` desde `@his/database` reciben este
 * `prisma` mockeable. Cada test concreto sobreescribe los métodos que
 * usa con `vitest-mock-extended` (mockDeep) o `vi.fn()`.
 *
 * Nota: este archivo SOLO se usa vía el alias en `vitest.config.ts`.
 */
import type { PrismaClient } from "@prisma/client";

// Construcción perezosa: cada router ve el mismo objeto, los tests
// reemplazan las propiedades antes de invocar la operación.
const prismaStub = {} as unknown as PrismaClient;

export const prisma = prismaStub;
export type { PrismaClient };
