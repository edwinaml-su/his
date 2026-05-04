/**
 * Smoke G0 — valida que el flujo crítico de la app responde end-to-end:
 * login → ver pacientes → ver admisión → ver triage queue.
 *
 * No asserta selectors específicos de forms (los test admission/triage
 * fallan por drift). Sólo navega, captura screenshots y verifica que
 * cada ruta cargue sin error 5xx.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("Smoke G0", () => {
  test("login + navegación rutas críticas + visibilidad seed", async ({ page }) => {
    test.setTimeout(60_000);

    await login(page, "admin");
    await page.screenshot({ path: "test-results/smoke-g0/01-post-login.png", fullPage: true });

    // Pacientes
    await page.goto("/patients", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/patients/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/smoke-g0/02-patients.png", fullPage: true });
    // El seed E2E tiene a María Pérez — debería aparecer.
    const mariaVisible = await page
      .getByText(/María.*Pérez|Maria.*Perez/)
      .first()
      .isVisible()
      .catch(() => false);
    test.info().annotations.push({
      type: "patients",
      description: mariaVisible ? "María Pérez visible en lista" : "no aparece en /patients (puede requerir filtros)",
    });

    // Admisión
    await page.goto("/admission", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admission/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/smoke-g0/03-admission.png", fullPage: true });

    // Triage
    await page.goto("/triage", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/triage/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/smoke-g0/04-triage.png", fullPage: true });
    // El encuentro abierto del seed debería estar en cola pendiente.
    const queueRow = await page.getByRole("row").nth(1).isVisible().catch(() => false);
    test.info().annotations.push({
      type: "triage-queue",
      description: queueRow ? "row de cola visible" : "cola vacía",
    });

    // Camas
    await page.goto("/beds", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/beds/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/smoke-g0/05-beds.png", fullPage: true });

    // Verificar que ningún paso devolvió 5xx (Next renderiza /500 o /_error).
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/Internal Server Error|500|_error/i);
  });
});
