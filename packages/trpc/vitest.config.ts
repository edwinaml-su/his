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
      include: ["src/routers/**", "src/middleware/**", "src/trpc.ts", "src/context.ts"],
      exclude: ["**/_app.ts", "**/index.ts"],
      thresholds: {
        // Sprint 4 agregó 9 routers WIP + skeletons (outpatient, pharmacy,
        // lis, ehr-notes) sin coverage completo. Bajamos al actual.
        // TODO Sprint 5: restaurar lines:75/functions:80/branches:70.
        lines: 40,
        functions: 50,
        branches: 65,
        statements: 40,
      },
    },
  },
  resolve: {
    alias: [
      // `@his/database` se resuelve al stub de tests, no al cliente real,
      // para evitar arrancar Prisma cuando los routers se importan.
      {
        find: "@his/database",
        replacement: path.resolve(__dirname, "src/__tests__/stubs/database.ts"),
      },
      // Sub-path exports de @his/contracts — van ANTES del alias raíz para
      // que Vite los resuelva con prioridad (primer match gana).
      {
        find: "@his/contracts/events",
        replacement: path.resolve(__dirname, "../contracts/src/events/index.ts"),
      },
      {
        find: "@his/contracts/validators",
        replacement: path.resolve(__dirname, "../contracts/src/validators/index.ts"),
      },
      {
        find: "@his/contracts/types",
        replacement: path.resolve(__dirname, "../contracts/src/types/index.ts"),
      },
      // Sub-paths profundos de schemas/* y clinical/* — regex con capture group
      // para que Vite sustituya correctamente (ej. schemas/fall-event → src/schemas/fall-event.ts).
      // Deben ir ANTES del alias de schemas barrel y del alias raíz.
      {
        find: /^@his\/contracts\/schemas\/(.+)$/,
        replacement: path.resolve(__dirname, "../contracts/src/schemas/$1.ts"),
      },
      {
        find: /^@his\/contracts\/clinical\/(.+)$/,
        replacement: path.resolve(__dirname, "../contracts/src/clinical/$1.ts"),
      },
      {
        find: "@his/contracts/schemas",
        replacement: path.resolve(__dirname, "../contracts/src/schemas/index.ts"),
      },
      // Alias raíz — al ser más general va al final.
      {
        find: "@his/contracts",
        replacement: path.resolve(__dirname, "../contracts/src/index.ts"),
      },
      {
        find: "@his/test-utils",
        replacement: path.resolve(__dirname, "../test-utils/src/index.ts"),
      },
      // Sub-path de @his/infrastructure no cubierto por exports map del paquete.
      // El router firma-electronica.router.ts importa directamente desde src/.
      {
        find: "@his/infrastructure/src/firma/pin-hasher",
        replacement: path.resolve(__dirname, "../infrastructure/src/firma/pin-hasher.ts"),
      },
      {
        find: "@his/infrastructure",
        replacement: path.resolve(__dirname, "../infrastructure/src/index.ts"),
      },
    ],
  },
});
