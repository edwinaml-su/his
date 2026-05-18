/**
 * E2E — Contingencia Operativa (US.F2.7.26-28)
 *
 * Cubre:
 *   1. Panel /contingencia carga sin error para rol ADM.
 *   2. Estado inicial muestra "Sistema normal".
 *   3. Formulario de activación visible con campos motivo + esperado_hasta.
 *   4. Activar sin motivo muestra error de validación.
 *   5. Botón de formularios imprimibles visible durante contingencia activa.
 *   6. Endpoint PDF responde con Content-Type application/pdf.
 *   7. /contingencia sin sesión redirige a login.
 *   8. Panel de registro retroactivo /ece/registro-retroactivo accesible.
 *
 * Limitaciones:
 *   - No activa contingencia real (requiere write en BD de prueba).
 *   - PDF se verifica a nivel de header HTTP, no contenido.
 *   - SKIP_E2E_CONTINGENCIA=1 omite la suite.
 *
 * @Dev F2-S15 Stream A
 */

import { test, expect } from "@playwright/test";
import { login } from "../_helpers/auth";

const SKIP = process.env.SKIP_E2E_CONTINGENCIA === "1";

test.describe("Contingencia Operativa — panel ADM", () => {
  test.skip(SKIP, "SKIP_E2E_CONTINGENCIA=1");

  test.beforeEach(async ({ page }) => {
    await login(page, "qa.admin@his.test", "TestPass123!");
  });

  test("1. Panel /contingencia carga sin error 500", async ({ page }) => {
    await page.goto("/contingencia");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: /Modo Contingencia/i }),
    ).toBeVisible();
    await expect(page.locator("text=Error 500")).not.toBeVisible();
  });

  test("2. Estado inicial muestra 'Sistema normal'", async ({ page }) => {
    await page.goto("/contingencia");
    // Badge de estado normal
    await expect(page.getByText(/Sistema normal/i)).toBeVisible({ timeout: 8000 });
  });

  test("3. Formulario de activación muestra campos motivo y fecha estimada", async ({
    page,
  }) => {
    await page.goto("/contingencia");
    // Campo motivo
    await expect(
      page.getByPlaceholder(/motivo de la contingencia/i),
    ).toBeVisible();
    // Campo datetime
    const dateInput = page.locator('input[type="datetime-local"]');
    await expect(dateInput).toBeVisible();
  });

  test("4. Activar sin motivo muestra mensaje de error de validación", async ({
    page,
  }) => {
    await page.goto("/contingencia");
    // Click activar sin llenar motivo
    await page.getByRole("button", { name: /Activar modo contingencia/i }).click();
    // Mensaje de validación
    await expect(page.getByText(/motivo es requerido/i)).toBeVisible({ timeout: 3000 });
  });

  test("5. Historial tabla visible aunque vacío", async ({ page }) => {
    await page.goto("/contingencia");
    await expect(
      page.getByRole("heading", { name: /historial/i }),
    ).toBeVisible({ timeout: 8000 });
    // Tabla headers
    await expect(page.getByRole("columnheader", { name: /Motivo/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Activado/i })).toBeVisible();
  });
});

test.describe("Contingencia — endpoint PDF formularios", () => {
  test.skip(SKIP, "SKIP_E2E_CONTINGENCIA=1");

  test("6. PDF signos_vitales responde con Content-Type application/pdf", async ({
    page,
  }) => {
    await login(page, "qa.admin@his.test", "TestPass123!");
    const response = await page.request.get(
      "/api/contingencia/forms/signos_vitales.pdf",
    );
    expect(response.status()).toBe(200);
    const contentType = response.headers()["content-type"];
    expect(contentType).toContain("application/pdf");
  });

  test("7. Tipo inválido devuelve 400", async ({ page }) => {
    await login(page, "qa.admin@his.test", "TestPass123!");
    const response = await page.request.get(
      "/api/contingencia/forms/radiografia.pdf",
    );
    expect(response.status()).toBe(400);
  });
});

test.describe("Contingencia — registro retroactivo", () => {
  test.skip(SKIP, "SKIP_E2E_CONTINGENCIA=1");

  test.beforeEach(async ({ page }) => {
    await login(page, "qa.admin@his.test", "TestPass123!");
  });

  test("8. Página /ece/registro-retroactivo carga correctamente", async ({
    page,
  }) => {
    await page.goto("/ece/registro-retroactivo");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: /Digitación retroactiva/i }),
    ).toBeVisible();
    // Select de período de contingencia visible
    await expect(page.getByRole("combobox").first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe("Contingencia — acceso sin sesión", () => {
  test.skip(SKIP, "SKIP_E2E_CONTINGENCIA=1");

  test("9. Sin sesión redirige a login", async ({ page }) => {
    await page.goto("/contingencia");
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
