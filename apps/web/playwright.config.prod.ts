/**
 * Playwright config — Smoke Production
 *
 * Config dedicada para `e2e/smoke-production.spec.ts`. Apunta a deployment vivo
 * (Vercel prod o staging), no levanta webServer local.
 *
 * Gated:
 *  - El spec hace test.skip() si `PROD_SMOKE !== '1'`.
 *  - Adicionalmente, esta config exige `E2E_BASE_URL` explícito (no permite
 *    default localhost para evitar falsos positivos).
 *
 * Uso:
 *  ```bash
 *  PROD_SMOKE=1 \
 *  E2E_BASE_URL=https://his-avante.vercel.app \
 *    npx playwright test --config=playwright.config.prod.ts
 *  ```
 *
 * Ver docs/22_smoke_production.md para guía completa.
 */
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error(
    'playwright.config.prod.ts requiere E2E_BASE_URL explícito (ej: https://his-avante.vercel.app). Setea PROD_SMOKE=1 y E2E_BASE_URL antes de correr.',
  );
}

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/smoke-production.spec.ts'],
  fullyParallel: false,
  retries: 1, // 1 retry para tolerar cold-start Vercel
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-prod' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off', // suite read-only, no necesitamos video
    locale: 'es-SV',
    timezoneId: 'America/El_Salvador',
    extraHTTPHeaders: {
      // Evita ser confundido con tráfico humano en analytics.
      'x-smoke-test': 'his-prod-smoke',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // NO webServer — apuntamos a deployment vivo.
});
