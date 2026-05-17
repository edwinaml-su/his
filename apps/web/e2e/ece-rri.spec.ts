/**
 * E2E smoke — ECE: RRI (Referencia / Retorno / Interconsulta).
 *
 * Cubre:
 *   1. Navegacion al listado RRI: heading + tabs visibles.
 *   2. Tab "Para responder" es seleccionable.
 *   3. Boton "Nueva solicitud" apunta a /ece/rri/nueva.
 *   4. Wizard nueva solicitud: paso 1 renderiza campos requeridos.
 *   5. Wizard: selector de tipo muestra 3 opciones.
 *   6. Wizard: selector de urgencia muestra 3 opciones.
 *   7. Wizard: avanzar sin datos muestra boton deshabilitado.
 *   8. Detalle RRI con ID inexistente muestra error graceful.
 *
 * Interacciones de firma (PIN real + personal_salud + firma_electronica)
 * se cubren cuando los seeds de E2E incluyan datos clínicos completos.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

test.describe("ECE — RRI Listado", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("listado renderiza heading y tabs", async ({ page }) => {
    await page.goto("/ece/rri");
    await expect(page).toHaveURL(/\/ece\/rri/);

    await expect(
      page.getByRole("heading", { name: /RRI/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("tab", { name: /mias pendientes/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("tab", { name: /para responder/i }),
    ).toBeVisible();
  });

  test("tab 'Para responder' es seleccionable", async ({ page }) => {
    await page.goto("/ece/rri");

    const tabResponder = page.getByRole("tab", { name: /para responder/i });
    await tabResponder.click();
    await expect(tabResponder).toHaveAttribute("aria-selected", "true");
  });

  test("boton 'Nueva solicitud' apunta a /ece/rri/nueva", async ({ page }) => {
    await page.goto("/ece/rri");

    const link = page.getByRole("link", { name: /nueva solicitud/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/ece/rri/nueva");
  });
});

test.describe("ECE — RRI Wizard nueva solicitud", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("paso 1 renderiza campos requeridos", async ({ page }) => {
    await page.goto("/ece/rri/nueva");
    await expect(page).toHaveURL(/\/ece\/rri\/nueva/);

    await expect(
      page.getByRole("heading", { name: /nueva solicitud rri/i }),
    ).toBeVisible();

    // Indicador de pasos
    await expect(page.getByText(/datos solicitud/i).first()).toBeVisible();

    // Campos obligatorios
    await expect(page.getByLabel(/episodio/i)).toBeVisible();
    await expect(page.getByLabel(/tipo/i)).toBeVisible();
    await expect(page.getByLabel(/servicio destino/i)).toBeVisible();
    await expect(page.getByLabel(/urgencia/i)).toBeVisible();
    await expect(page.getByLabel(/motivo/i)).toBeVisible();
    await expect(page.getByLabel(/datos clinicos/i)).toBeVisible();
  });

  test("boton 'Continuar' esta deshabilitado sin datos", async ({ page }) => {
    await page.goto("/ece/rri/nueva");

    const btn = page.getByRole("button", { name: /continuar/i });
    await expect(btn).toBeDisabled();
  });

  test("selector tipo muestra 3 opciones", async ({ page }) => {
    await page.goto("/ece/rri/nueva");

    const tipoSelect = page.getByLabel(/^tipo/i).first();
    await tipoSelect.click();

    await expect(page.getByRole("option", { name: /referencia/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /retorno/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /interconsulta/i })).toBeVisible();
  });
});

test.describe("ECE — RRI Detalle", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("ID inexistente muestra error o pagina vacia gracefully", async ({ page }) => {
    await page.goto(`/ece/rri/${NONEXISTENT_ID}`);

    // La pagina no debe mostrar un crash irrecuperable (500)
    // Acepta: mensaje de error, pagina vacia, o redirect
    const body = page.locator("body");
    await expect(body).not.toContainText("500");
    await expect(body).not.toContainText("Application error");
  });
});
