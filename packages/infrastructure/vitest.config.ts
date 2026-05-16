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
    alias: {
      // Resuelve el workspace @his/contracts al source TS directamente.
      // Necesario para vitest local (fuera de turbo) — en CI turbo compila
      // el workspace y la resolución funciona por node_modules.
      "@his/contracts": path.resolve(__dirname, "../contracts/src/index.ts"),
    },
  },
  test: {
    name: "infrastructure",
    environment: "node",
    globals: false,
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/notifications/**", "src/observability/**"],
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
