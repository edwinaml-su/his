/**
 * Vitest config para `@his/trpc`.
 * Tests de integración con Prisma mockeado (vitest-mock-extended).
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    name: "trpc",
    environment: "node",
    globals: false,
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/routers/**", "src/trpc.ts", "src/context.ts"],
      exclude: ["**/_app.ts", "**/index.ts"],
      thresholds: {
        lines: 75,
        functions: 80,
        branches: 70,
        statements: 75,
      },
    },
  },
  resolve: {
    alias: {
      // `@his/database` se resuelve al stub de tests, no al cliente real,
      // para evitar arrancar Prisma cuando los routers se importan.
      "@his/database": path.resolve(__dirname, "src/__tests__/stubs/database.ts"),
    },
  },
});
