/**
 * E2E — flujo de autenticación.
 * US: AUTH-01 (login), AUTH-02 (login inválido), AUTH-03 (signup deshabilitado),
 *     AUTH-04 (logout).
 */
import { test, expect } from "@playwright/test";
import { TEST_CREDENTIALS, login } from "./_helpers/auth";

test.describe("Autenticación", () => {
  test("login exitoso redirige a área autenticada", async ({ page }) => {
    await login(page, "admin");
    // El layout autenticado debe mostrar el menú lateral.
    await expect(page.getByRole("navigation")).toBeVisible();
  });

  test("login con credenciales inválidas muestra error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/correo|email/i).fill(TEST_CREDENTIALS.admin.email);
    await page.getByLabel(/contraseña|password/i).fill("contraseña-invalida");
    await page.getByRole("button", { name: /ingresar|iniciar sesión|login/i }).click();

    // El error debe ser anunciado vía role=alert (a11y).
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signup público está deshabilitado en producción del MVP", async ({ page }) => {
    const resp = await page.goto("/signup");
    // O bien la página retorna 404, o redirige a login con un mensaje informativo.
    expect([404, 200]).toContain(resp?.status() ?? 0);
    if (resp?.status() === 200) {
      await expect(page.getByText(/registro deshabilitado|contacta al administrador/i)).toBeVisible();
    }
  });

  test("logout limpia la sesión", async ({ page }) => {
    await login(page, "admin");
    await page.getByRole("button", { name: /perfil|cuenta|menú/i }).click();
    await page.getByRole("menuitem", { name: /cerrar sesión|logout/i }).click();
    await page.waitForURL(/\/login/);
    // Volver a entrar a un área protegida debe redirigir a /login.
    await page.goto("/patients");
    await page.waitForURL(/\/login/);
  });
});
