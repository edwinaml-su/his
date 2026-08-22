/**
 * Vitest config para `@his/ui`.
 * Ambiente jsdom por defecto (componentes React); los tests individuales
 * pueden fijar `// @vitest-environment jsdom` de forma explícita si hace falta.
 *
 * Hallazgo P1-4: este workspace no tenía script `test` ni config vitest, así
 * que `turbo run test` lo omitía en silencio y sus tests nunca corrían en CI
 * (mismo patrón de bug pagado en @his/infrastructure — ver CLAUDE.md).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ui",
    environment: "jsdom",
    globals: false,
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // Scoped a lo que hoy tiene tests reales (abbr.tsx + lib/abbreviations.ts).
      // El resto de src/components/** son wrappers Shadcn/Radix sin tests
      // dedicados — no incluir en coverage.include hasta que existan
      // (mismo patrón que packages/contracts y packages/infrastructure).
      include: ["src/components/abbr.tsx", "src/lib/abbreviations.ts"],
      exclude: ["**/index.ts", "**/__tests__/**"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
