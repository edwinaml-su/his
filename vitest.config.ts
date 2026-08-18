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
      "packages/infrastructure",
      "packages/trpc",
      "apps/web",
    ],
    // BUG-DOD-001: excluir specs de Playwright para que `npm run test:coverage`
    // no intente ejecutar archivos e2e con el runner de Vitest.
    // NOTA (2026-08-17): `npm run test:coverage` NO es el gate real. Con
    // `projects` definido, el proyecto raíz ADEMÁS recoge tests por su cuenta y
    // corre los de `apps/web` sin su ambiente jsdom ni el alias `@/` → fallan
    // con `document is not defined`. Poner `include: []` los silencia pero deja
    // la cobertura agregada en 0% (cada proyecto reporta la suya). Arreglarlo
    // requiere migrar a coverage de workspace; está en el backlog Beta.23.
    // El gate que corre CI y que sí pasa es `npx turbo run test -- --coverage`.
    // `.claude/worktrees/**`: los worktrees efímeros de agentes son copias
    // COMPLETAS del repo. Sin excluirlos, el runner raíz recoge sus tests y
    // los corre con el ambiente equivocado (`document is not defined` en los
    // tests de componentes), rompiendo `test:coverage` en local aunque CI —
    // que hace checkout limpio — esté verde.
    exclude: [
      "**/e2e/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.claude/**",
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
        "**/.claude/**",
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
