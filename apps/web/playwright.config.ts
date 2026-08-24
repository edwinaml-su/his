/**
 * Playwright config (TDR §29.6 — pruebas E2E).
 *
 * - webServer: levanta `npm run dev` localmente; en CI usa `npm run start`
 *   contra build previa (más rápido, más fiel a producción).
 * - baseURL: `http://localhost:3000`.
 * - Reportes JUnit + HTML para integrarse con el pipeline.
 *
 * Filtrado por tag:
 *   E2E_GREP=@smoke npm run test:e2e   → solo specs marcados @smoke
 *   E2E_GREP=@smoke npx playwright test → equivalente directo
 *
 * La convención de tagging usa el nombre del describe/test:
 *   test.describe("@smoke - Admisión", () => { ... })
 */
import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
// Inyectar filtro de tags desde env. Smoke PR usa E2E_GREP=@smoke.
const grepFilter = process.env.E2E_GREP ? new RegExp(process.env.E2E_GREP) : undefined;
// Override puntual del circuit breaker (ver comentario en maxFailures más abajo).
// Uso: corridas de diagnóstico que necesitan ver el inventario completo de
// fallos en vez de cortar en 8/25. Sin la env var, se mantienen los defaults.
const maxFailuresOverrideRaw = process.env.E2E_MAX_FAILURES ? Number(process.env.E2E_MAX_FAILURES) : undefined;
if (maxFailuresOverrideRaw !== undefined && !Number.isFinite(maxFailuresOverrideRaw)) {
  throw new Error(`E2E_MAX_FAILURES debe ser numérico, recibido: "${process.env.E2E_MAX_FAILURES}"`);
}
const maxFailuresOverride = maxFailuresOverrideRaw;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // E2E comparten BD test → serializamos para evitar races.
  retries: isCI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  // Smoke PR: 1 retry (fallos transitorios de red). Full nightly: 2 retries.
  ...(grepFilter ? { retries: isCI ? 1 : 0 } : {}),
  // Filtrado por tag (E2E_GREP=@smoke selecciona solo tests cuyo nombre contiene @smoke).
  ...(grepFilter ? { grep: grepFilter } : {}),
  // Circuit breaker: si el ambiente está roto (ej. auth backend no disponible),
  // cada test falla igual pero de forma determinística — no tiene sentido agotar
  // los 60s×retries de las ~80 specs una por una hasta chocar con timeout-minutes
  // del workflow. Cortamos temprano y dejamos evidencia clara en el reporter.
  // Smoke (PR, grep @smoke): corta rápido, es un gate de PR. Nightly: margen mayor
  // porque busca cobertura de reporte, pero sigue acotado (no corre indefinido).
  maxFailures: isCI ? (maxFailuresOverride ?? (grepFilter ? 8 : 25)) : undefined,
  reporter: isCI
    ? [["line"], ["html", { open: "never" }], ["junit", { outputFile: "playwright-report/results.xml" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "es-SV",
    timezoneId: "America/El_Salvador",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: isCI ? "npm run start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !isCI,
    timeout: 120_000,
    // Por defecto Playwright IGNORA el stdout/stderr del webServer. En CI eso
    // significa que si `next start` cuelga o tarda, el log del job queda en
    // silencio total (sin evidencia) hasta el timeout — confirmado en el run
    // 32093103211 (2026-08-18): 16m22s sin una sola línea entre "Running
    // test:e2e" y la cancelación. Con esto el boot del server queda visible.
    stdout: isCI ? "pipe" : "ignore",
    stderr: "pipe",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/his_test",
    },
  },
});
