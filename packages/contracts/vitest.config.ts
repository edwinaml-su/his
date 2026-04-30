/**
 * Vitest config para `@his/contracts`.
 * Ambiente node (los validators y schemas no requieren DOM); se mantiene
 * la nomenclatura `jsdom` reservada para cuando contracts exporte hooks UI
 * (no aplica en MVP).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "contracts",
    environment: "node",
    globals: false,
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/validators/**", "src/schemas/**"],
      exclude: ["**/index.ts"],
      thresholds: {
        // Validators son lógica pura crítica → 100%.
        // Schemas Zod son declarativos → 90%.
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
