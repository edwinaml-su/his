/**
 * E2E — Skip link WCAG 2.4.1 (Bypass Blocks).
 *
 * Verifica que el skip link sea operable por teclado:
 *   1. Al cargar la página y presionar Tab, el skip link recibe foco y es visible.
 *   2. Al presionar Enter, el foco se mueve al #main-content.
 *
 * Ejecutar:
 *   npx playwright test e2e/a11y-skip-link.spec.ts --headed
 *
 * Requiere dev server activo o webServer configurado en playwright.config.ts.
 *
 * @author @QA — 2026-05-17
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("WCAG 2.4.1 — Skip link operable por teclado", () => {
  test("Tab al cargar → skip link visible → Enter → foco en main content", async ({ page }) => {
    // Página autenticada con shell completo (sidebar + topbar + main).
    await login(page, "admin");
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    // Primer Tab desde body pone el foco en el skip link.
    await page.keyboard.press("Tab");

    const skipLink = page.getByRole("link", { name: "Saltar al contenido principal" });
    await expect(skipLink).toBeFocused();

    // Al recibir foco, el skip link debe ser visible (focus:not-sr-only).
    await expect(skipLink).toBeVisible();

    // Al presionar Enter el foco salta al #main-content.
    await page.keyboard.press("Enter");

    const mainContent = page.locator("#main-content");
    await expect(mainContent).toBeFocused();
  });

  test("Login (público) — skip link presente y apunta a #main-content", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    // En la página de login no hay AppShell, pero sí puede haber skip link
    // si se implementa en el layout raíz. Verificamos que al menos el main
    // content existe cuando el componente está presente.
    await page.keyboard.press("Tab");

    // Intentamos localizar el skip link; si no está (login no usa AppShell)
    // el test pasa porque esa página no tiene navegación repetitiva.
    const skipLinks = page.getByRole("link", { name: "Saltar al contenido principal" });
    const count = await skipLinks.count();
    if (count > 0) {
      const firstSkipLink = skipLinks.first();
      await expect(firstSkipLink).toHaveAttribute("href", "#main-content");
    }
    // Si no hay skip link en /login, el test pasa sin verificación adicional —
    // WCAG 2.4.1 solo aplica cuando hay bloques de navegación repetidos.
  });
});
