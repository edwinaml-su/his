/**
 * E2E — Master Patient Index (MPI).
 * US: MPI-01 (registro), MPI-02 (búsqueda), MPI-03 (vista 360°), MPI-04 (alergia destacada).
 *
 * Limitación: la "comparación fonética / probabilística" para detectar
 * duplicados (TDR §10) está marcada como Fase 4. Aquí solo validamos
 * búsqueda determinista por nombre y por DUI.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";
import { VALID_DUIS } from "@his/test-utils";

test.describe("@smoke - MPI — registro y búsqueda de paciente", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("registrar paciente con DUI válido", async ({ page }) => {
    await page.goto("/patients/new");

    const dui = VALID_DUIS[5]!;
    await page.getByLabel(/nombre/i).first().fill("Carmen");
    await page.getByLabel(/apellido/i).first().fill("Reyes");
    await page.getByLabel(/fecha de nacimiento/i).fill("1988-04-12");
    await page.getByLabel(/sexo biológico/i).click();
    await page.getByRole("option", { name: /femenino/i }).click();

    await page.getByRole("button", { name: /agregar identificador/i }).click();
    await page.getByLabel(/tipo/i).last().click();
    await page.getByRole("option", { name: /^DUI/ }).click();
    await page.getByLabel(/valor/i).last().fill(dui);

    await page.getByRole("button", { name: /guardar|crear paciente/i }).click();

    // Confirmación: redirige a la vista 360° del paciente recién creado.
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: /Carmen Reyes/i })).toBeVisible();
  });

  test("búsqueda por nombre recupera el paciente", async ({ page }) => {
    await page.goto("/patients");
    await page.getByRole("searchbox").fill("Carmen");
    await expect(page.getByText(/Carmen Reyes/i).first()).toBeVisible();
  });

  test("búsqueda por DUI recupera el paciente", async ({ page }) => {
    await page.goto("/patients");
    const dui = VALID_DUIS[5]!;
    await page.getByRole("searchbox").fill(dui.slice(0, 6));
    await expect(page.getByText(/Carmen Reyes/i).first()).toBeVisible();
  });

  test("vista 360° muestra alergias con marca visual destacada", async ({ page }) => {
    await page.goto("/patients");
    await page.getByText(/María Pérez/i).first().click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}/);

    // El componente AllergyBadge debe estar presente con role=alert para severas.
    const badge = page.getByRole("alert", { name: /alergia.*penicilina/i });
    await expect(badge).toBeVisible();
    // La marca visual no debe ser sólo color: debe tener texto/ARIA label.
    await expect(badge).toHaveAccessibleName(/alergia/i);
  });

  test("ingresar DUI inválido muestra error de validación", async ({ page }) => {
    await page.goto("/patients/new");
    await page.getByLabel(/nombre/i).first().fill("Test");
    await page.getByLabel(/apellido/i).first().fill("Inválido");
    await page.getByRole("button", { name: /agregar identificador/i }).click();
    await page.getByLabel(/tipo/i).last().click();
    await page.getByRole("option", { name: /^DUI/ }).click();
    await page.getByLabel(/valor/i).last().fill("12345678-0"); // verificador erróneo
    await page.getByRole("button", { name: /guardar|crear paciente/i }).click();

    await expect(page.getByText(/identificador inválido|DUI inválido/i)).toBeVisible();
  });
});
