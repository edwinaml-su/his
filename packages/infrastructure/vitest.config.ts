/**
 * Vitest config para `@his/infrastructure`.
 * Ambiente node — los adapters de infraestructura no requieren DOM.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "infrastructure",
    environment: "node",
    globals: false,
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/notifications/**", "src/observability/**"],
      exclude: ["**/index.ts"],
      thresholds: {
        // Sprint Beta.15 — solo `resend.ts` tiene tests dedicados; el logger
        // se cubre indirecto. Subir umbrales cuando se añadan tests del logger.
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
