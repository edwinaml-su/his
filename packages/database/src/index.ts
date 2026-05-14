/**
 * @his/database — Prisma client singleton.
 *
 * En desarrollo Next.js hot-reload puede crear múltiples PrismaClient.
 * Usamos una variable global para reutilizar la instancia (patrón oficial Prisma).
 *
 * Ref: https://www.prisma.io/docs/orm/more/help-and-troubleshooting/help-articles/nextjs-prisma-client-dev-practices
 */
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __hisPrisma: PrismaClient | undefined;
}

const isProd = process.env.NODE_ENV === "production";

export const prisma: PrismaClient =
  globalThis.__hisPrisma ??
  new PrismaClient({
    log: isProd ? ["error"] : ["query", "warn", "error"],
  });

if (!isProd) {
  globalThis.__hisPrisma = prisma;
}

export * from "@prisma/client";
export { emitDomainEvent } from "./outbox/emit";
export type { EmitDomainEventInput, EmitDomainEventTx } from "./outbox/emit";
export default prisma;
