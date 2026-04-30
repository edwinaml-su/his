/**
 * Setup global para tests de routers tRPC.
 * - Silencia logs de Prisma esperados.
 * - Define matchers personalizados si hace falta.
 */
import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});
