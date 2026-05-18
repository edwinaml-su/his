/**
 * Vitest config para `@his/database`.
 *
 * Solo cubre tests PUROS — módulos que no instancian `PrismaClient` ni tocan
 * la BD. Tests con BD viven en su workspace correspondiente (`@his/trpc` con
 * Prisma mockeado; `@his/web` con E2E Playwright contra Supabase real).
 *
 * Scope inicial: matriz `RoleNotificationDefault` (US.B15.3.4).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "database",
    environment: "node",
    globals: false,
    include: [
      "src/**/__tests__/**/*.test.ts",
      "scripts/__tests__/**/*.test.mjs",
    ],
  },
});
