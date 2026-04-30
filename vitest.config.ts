/**
 * Configuración Vitest raíz — compone proyectos por workspace (TDR §29.6).
 * Cobertura objetivo global: ≥ 80% líneas/branches en código de negocio.
 *
 * Uso:
 *   npm run test               → corre todos los workspaces
 *   npm run test:coverage      → genera reporte combinado V8 en /coverage
 *
 * Nota: cada workspace tiene su propio `vitest.config.ts` con el ambiente
 * adecuado (node, jsdom). Aquí solo se compone.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest 1.x: `projects` ejecuta cada subconfig en paralelo.
    projects: [
      "packages/contracts",
      "packages/trpc",
      "apps/web",
    ],
    // Cobertura agregada en el comando raíz.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // Umbrales obligatorios para que CI rechace regresiones.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      // No medir tipos/configs/seeds/migraciones/entrypoints sin lógica.
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.next/**",
        "**/coverage/**",
        "**/*.config.{ts,js,mjs,cjs}",
        "**/*.d.ts",
        "**/__tests__/**",
        "**/e2e/**",
        "**/prisma/seed.ts",
        "**/prisma/migrations/**",
        "**/index.ts", // re-exports
      ],
    },
    passWithNoTests: false,
  },
});
