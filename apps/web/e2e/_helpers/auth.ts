/**
 * Helpers de autenticación para E2E.
 * En tests E2E reales, debe usar Supabase test users sembrados o un endpoint
 * `/api/test/login` habilitado solo en NODE_ENV=test.
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
  await page.goto("/login");
  await page.getByLabel(/correo|email/i).fill(creds.email);
  await page.getByLabel(/contraseña|password/i).fill(creds.password);
  await page.getByRole("button", { name: /ingresar|iniciar sesión|login/i }).click();
  await page.waitForURL(/\/(dashboard|patients|beds|triage|admission)/);
}
