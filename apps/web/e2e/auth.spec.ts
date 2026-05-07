/**
 * E2E — flujo de autenticación.
 * US: AUTH-01 (login), AUTH-02 (login inválido), AUTH-03 (signup deshabilitado),
 *     AUTH-04 (sesión expira por inactividad).
 *
 * NOTA Sprint 3: el "logout via menu" no existe en MVP — la única salida
 * autorizada es el diálogo de inactividad (15 min). Test 4 simula la
 * expiración limpiando storage y verificando que protected routes
 * redirigen a /login.
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
    // Ruta real: /auth/signup (Sprint 3 — antes era /signup).
    const resp = await page.goto("/auth/signup");
    expect(resp?.status() ?? 0).toBeLessThan(500);
    await expect(page.getByText(/registro deshabilitado/i)).toBeVisible();
    await expect(
      page.getByText(/contacta al administrador|sólo por invitación/i),
    ).toBeVisible();
  });

  test("sesión expira: limpiar storage redirige áreas protegidas a /login", async ({
    page,
    context,
  }) => {
    await login(page, "admin");
    // Simulamos expiración limpiando cookies y storage Supabase Auth.
    await context.clearCookies();
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto("/patients");
    await page.waitForURL(/\/login/);
  });
});
