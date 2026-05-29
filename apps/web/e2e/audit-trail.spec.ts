/**
 * E2E — Audit trail.
 * US: AUD-01 (toda mutación queda registrada), AUD-02 (visor de auditoría).
 *
 * Estrategia: ejecuta una mutación conocida (cambiar estado de cama) y
 * verifica que el visor de auditoría sobre esa entidad muestra el evento
 * con el usuario actor y la timestamp.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("@smoke - Audit trail", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("cambio de estado de cama queda en audit log y se ve en el visor", async ({ page }) => {
    await page.goto("/beds");

    // Cambiamos una cama a MANTENIMIENTO.
    const free = page.getByRole("button", { name: /cama.*libre/i }).first();
    await free.click();
    await page.getByRole("button", { name: /cambiar estado/i }).click();
    await page.getByRole("option", { name: /mantenimiento/i }).click();
    await page.getByLabel(/motivo/i).fill("Prueba E2E auditoría.");
    await page.getByRole("button", { name: /confirmar/i }).click();

    // Visor de auditoría sobre la cama (admin → /admin/audit).
    await page.goto("/admin/audit");
    await page.getByLabel(/entidad/i).fill("Bed");
    await page.getByRole("button", { name: /buscar/i }).click();

    // Debe aparecer al menos un evento UPDATE con el usuario actual.
    const row = page.getByRole("row", { name: /bed.*update/i }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/qa.admin@his.test/i);
  });
});
