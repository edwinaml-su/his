/**
 * E2E — Mapa de camas.
 * US: BED-01 (mapa), BED-02 (detalle de cama).
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("Mapa de camas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("mapa renderiza servicios y camas con estado coherente", async ({ page }) => {
    await page.goto("/beds");

    // Cada estado tiene texto/aria-label, no solo color.
    await expect(page.getByText(/libre|ocupada|sucia|mantenimiento|reservada/i).first()).toBeVisible();

    // Las camas son botones accesibles por nombre.
    const bedButtons = page.getByRole("button", { name: /cama/i });
    await expect(bedButtons.first()).toBeVisible();
  });

  test("click en cama ocupada muestra ocupante (paciente y encuentro)", async ({ page }) => {
    await page.goto("/beds");

    const occupied = page.getByRole("button", { name: /cama.*ocupada/i }).first();
    await occupied.click();

    // Drawer/panel con datos del paciente y número de encuentro.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/ENC-\d{4}-\d{6}/)).toBeVisible();
  });
});
