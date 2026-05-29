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
  reporter: isCI
    ? [["html", { open: "never" }], ["junit", { outputFile: "playwright-report/results.xml" }]]
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
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/his_test",
    },
  },
});
