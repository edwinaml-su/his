/**
 * Vitest config para `@his/web`.
 * Tests unitarios de componentes/utilidades de la app Next.js.
 * Los tests E2E viven en `e2e/` y se ejecutan con Playwright (no Vitest).
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    name: "web",
    environment: "jsdom",
    globals: false,
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    // Excluye explícitamente la carpeta E2E para que no la intente correr Vitest.
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/components/**"],
      exclude: ["**/*.stories.tsx", "**/index.ts"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
