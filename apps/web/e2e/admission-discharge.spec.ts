/**
 * E2E — Admisión, traslado interno y alta.
 * US: ADM-01 (admisión), ADM-02 (traslado), ADM-03 (alta médica).
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("Admisión → Traslado → Alta", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("admitir paciente asigna cama y crea encuentro ENC-YYYY-XXXXXX", async ({ page }) => {
    await page.goto("/admission/new");

    await page.getByLabel(/paciente/i).fill("María Pérez");
    await page.getByRole("option", { name: /María Pérez/i }).click();

    await page.getByLabel(/tipo de admisión/i).click();
    await page.getByRole("option", { name: /emergencia/i }).click();

    await page.getByLabel(/servicio/i).click();
    await page.getByRole("option").first().click();

    await page.getByLabel(/cama/i).click();
    await page.getByRole("option", { name: /libre|FREE/i }).first().click();

    await page.getByRole("button", { name: /admitir/i }).click();

    await expect(page.getByText(/ENC-\d{4}-\d{6}/)).toBeVisible();
  });

  test("traslado interno mueve la cama y actualiza estado", async ({ page }) => {
    await page.goto("/encounters");
    await page.getByText(/ENC-\d{4}-\d{6}/).first().click();

    await page.getByRole("button", { name: /trasladar/i }).click();
    await page.getByLabel(/servicio destino/i).click();
    await page.getByRole("option").first().click();
    await page.getByLabel(/motivo/i).fill("Cambio a UCI por deterioro clínico.");
    await page.getByRole("button", { name: /confirmar traslado/i }).click();

    await expect(page.getByText(/traslado registrado/i)).toBeVisible();
  });

  test("alta médica cierra encuentro y libera cama (DIRTY)", async ({ page }) => {
    await page.goto("/encounters");
    await page.getByText(/ENC-\d{4}-\d{6}/).first().click();

    await page.getByRole("button", { name: /dar de alta|alta/i }).click();
    await page.getByLabel(/tipo de alta/i).click();
    await page.getByRole("option", { name: /médica/i }).click();
    await page.getByRole("button", { name: /confirmar alta/i }).click();

    await expect(page.getByText(/encuentro cerrado|alta registrada/i)).toBeVisible();
    // La cama debe quedar en DIRTY (esperando limpieza).
    await page.goto("/beds");
    await expect(page.getByLabel(/cama.*sucia|DIRTY/i).first()).toBeVisible();
  });
});
