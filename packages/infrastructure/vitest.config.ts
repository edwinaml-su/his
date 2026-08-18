/**
 * Vitest config para `@his/infrastructure`.
 * Ambiente node — los adapters de infraestructura no requieren DOM.
 *
 * Cubre adapters externos (Resend, observability) y el dispatcher de
 * notificaciones (Beta.15) con Prisma + EmailProvider mockeados.
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: [
      // Sub-path exports de @his/contracts (ej. schemas/prevent) — deben ir
      // ANTES del alias raíz (mismo orden que packages/trpc/vitest.config.ts)
      // porque el alias raíz es un match exacto, no un prefijo, y no resuelve
      // subpaths por sí solo.
      {
        find: /^@his\/contracts\/schemas\/(.+)$/,
        replacement: path.resolve(__dirname, "../contracts/src/schemas/$1.ts"),
      },
      // Resuelve el workspace @his/contracts al source TS directamente.
      // Necesario para vitest local (fuera de turbo) — en CI turbo compila
      // el workspace y la resolución funciona por node_modules.
      {
        find: "@his/contracts",
        replacement: path.resolve(__dirname, "../contracts/src/index.ts"),
      },
    ],
  },
  test: {
    name: "infrastructure",
    environment: "node",
    globals: false,
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/notifications/**", "src/observability/**", "src/formula/**"],
      exclude: ["**/index.ts", "**/__tests__/**"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
