/**
 * Playwright config (TDR §29.6 — pruebas E2E).
 *
 * - webServer: levanta `npm run dev` localmente; en CI usa `npm run start`
 *   contra build previa (más rápido, más fiel a producción).
 * - baseURL: `http://localhost:3000`.
 * - Reportes JUnit + HTML para integrarse con el pipeline.
 */
import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // E2E comparten BD test → serializamos para evitar races.
  retries: isCI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 8_000 },
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
