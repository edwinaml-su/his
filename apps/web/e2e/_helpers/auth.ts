/**
 * Helpers de autenticación para E2E.
 * En tests E2E reales, debe usar Supabase test users sembrados o un endpoint
 * `/api/test/login` habilitado solo en NODE_ENV=test.
 *
 * Usuarios disponibles (sembrados por packages/database/scripts/seed-test-users.mjs):
 *   qa.admin@his.test      / TestPass123!  → rol ADMIN
 *   qa.triagist@his.test   / TestPass123!  → rol TRIAGIST
 *   qa.physician@his.test  / TestPass123!  → rol PHYSICIAN (MC)
 *   qa.nurse@his.test      / TestPass123!  → rol NURSE (ENF)
 *   qa.director@his.test   / TestPass123!  → rol DIRECTOR (DIR)
 */
import type { Page } from "@playwright/test";

export const TEST_CREDENTIALS = {
  admin:     { email: "qa.admin@his.test",     password: "TestPass123!" },
  triagist:  { email: "qa.triagist@his.test",  password: "TestPass123!" },
  physician: { email: "qa.physician@his.test", password: "TestPass123!" },
  nurse:     { email: "qa.nurse@his.test",     password: "TestPass123!" },
  director:  { email: "qa.director@his.test",  password: "TestPass123!" },
};

export async function login(page: Page, who: keyof typeof TEST_CREDENTIALS = "admin") {
  const creds = TEST_CREDENTIALS[who];
  // ?skipIntro=1 salta la animación AxisMed (CC-0010) — la tarjeta de login
  // queda visible de inmediato, sin esperar los ~12.6s de la secuencia.
  await page.goto("/login?skipIntro=1");
  await page.getByLabel(/correo|email/i).fill(creds.email);
  await page.getByLabel(/contraseña|password/i).fill(creds.password);
  await page.getByRole("button", { name: /ingresar|iniciar sesión|login/i }).click();
  await maybeSelectSede(page);
  await page.waitForURL(/\/(dashboard|patients|beds|triage|admission)/);
}

/**
 * Paso 2 del login (CC-0010): si el usuario tiene más de una sede activa,
 * aparece un select "Sede" antes de entrar. Si solo tiene una, el login
 * auto-avanza sin mostrar este paso — por eso es tolerante: no falla si
 * el select nunca aparece.
 */
async function maybeSelectSede(page: Page): Promise<void> {
  const sedeSelect = page.locator("#loginSede");
  try {
    await sedeSelect.waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    return;
  }
  const options = await sedeSelect.locator("option").all();
  if (options.length > 1) {
    const value = await options[1]!.getAttribute("value");
    if (value) await sedeSelect.selectOption(value);
  }
  await page.getByRole("button", { name: /ingresar a la sede|enter site/i }).click();
}
