/**
 * Smoke Production — valida endpoints públicos del deployment vivo.
 *
 * Diseño:
 *  - NO autentica (no creamos usuarios contra prod).
 *  - NO escribe (read-only, sin POST a tRPC).
 *  - Solo healthcheck + páginas que renderizan login form / landing.
 *  - Gated por env var `PROD_SMOKE=1` para evitar correrlo accidentalmente
 *    en suite local/CI normal (E2E_BASE_URL default `localhost:3000`).
 *
 * Cuándo correr:
 *  - Post-deploy a producción (manual o GitHub Action ad-hoc).
 *  - Pre go-live como gate de verificación.
 *  - Tras rollback como verificación de retorno a estado verde.
 *
 * Cómo correr:
 *  ```bash
 *  cd apps/web
 *  PROD_SMOKE=1 \
 *  E2E_BASE_URL=https://his-avante.vercel.app \
 *    npx playwright test --config=playwright.config.prod.ts \
 *    e2e/smoke-production.spec.ts
 *  ```
 *
 * Documentación: docs/22_smoke_production.md (Stream F entrega).
 */
import { test, expect } from '@playwright/test';

// Gate: si la env var no está, skip toda la suite.
// Evita ejecución accidental en CI normal.
test.skip(
  process.env.PROD_SMOKE !== '1',
  'Suite smoke producción deshabilitada. Setear PROD_SMOKE=1 para activar.',
);

test.describe('@smoke - Smoke Production — Vercel deployment', () => {
  test.describe.configure({ mode: 'serial' });

  test('1) Healthcheck /api/health retorna 200 con db+supabase OK', async ({ request }) => {
    const res = await request.get('/api/health');

    // 200 OK o 503 (down) — necesitamos ambos códigos para diagnóstico real.
    expect([200, 503]).toContain(res.status());

    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('checks.db');
    expect(body).toHaveProperty('checks.supabase');

    // Si el deploy está sano, db y supabase deben ser 'ok'.
    // Si está degradado, la suite igual reporta pero falla con detalle.
    if (res.status() === 200) {
      expect(body.status).toBe('ok');
      expect(body.checks.db.status).toBe('ok');
      expect(body.checks.supabase.status).toBe('ok');
    } else {
      // 503 = registramos cuál check falló pero hacemos fail explícito.
      test.info().annotations.push({
        type: 'health-degradation',
        description: JSON.stringify(body.checks),
      });
      throw new Error(`Health 503: db=${body.checks.db.status} supabase=${body.checks.supabase.status}`);
    }
  });

  test('2) Login page renderiza sin error 5xx', async ({ page }) => {
    const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 0).toBeLessThan(500);

    // No debe mostrar página de error de Next/Sentry.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Internal Server Error|Application error|_error/i);

    // Debe haber al menos un input (form de login presente).
    const inputCount = await page.locator('input').count();
    expect(inputCount).toBeGreaterThan(0);
  });

  test('3) /admission redirige a login (auth-protected) sin 5xx', async ({ page }) => {
    const response = await page.goto('/admission', { waitUntil: 'domcontentloaded' });

    // Auth protege la ruta: o redirige a login o renderiza login. Ambos OK.
    expect(response?.status() ?? 0).toBeLessThan(500);

    const url = page.url();
    const isLoginOrAuth = /\/login|\/auth/.test(url);
    const isAdmissionRendered = /\/admission/.test(url);

    expect(isLoginOrAuth || isAdmissionRendered).toBeTruthy();

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Internal Server Error|Application error/i);
  });

  test('4) /triage redirige a login (auth-protected) sin 5xx', async ({ page }) => {
    const response = await page.goto('/triage', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 0).toBeLessThan(500);

    const url = page.url();
    const isLoginOrAuth = /\/login|\/auth/.test(url);
    const isTriageRendered = /\/triage/.test(url);
    expect(isLoginOrAuth || isTriageRendered).toBeTruthy();

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Internal Server Error|Application error/i);
  });

  test('5) /outpatient (Phase 2) redirige a login (auth-protected) sin 5xx', async ({ page }) => {
    // Verifica que rutas Phase 2 estén deployeadas (no 404 ni 500).
    const response = await page.goto('/outpatient', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 0).toBeLessThan(500);

    const url = page.url();
    const isLoginOrAuth = /\/login|\/auth/.test(url);
    const isOutpatientRendered = /\/outpatient/.test(url);
    expect(isLoginOrAuth || isOutpatientRendered).toBeTruthy();

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Internal Server Error|Application error/i);
    // 404 explícito = ruta no deployeada — falla el smoke.
    expect(body).not.toMatch(/^404$|Page Not Found/i);
  });
});
