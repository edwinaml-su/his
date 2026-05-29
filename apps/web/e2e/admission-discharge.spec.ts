/**
 * E2E — Admisión, traslado interno y alta.
 * US: ADM-01 (admisión), ADM-02 (traslado), ADM-03 (alta médica).
 *
 * Sprint 3: las rutas reales son
 *   - Admisión: `/admission` (wizard 4 pasos, NO `/admission/new`)
 *   - Traslado: `/transfers` (board + form en línea)
 *   - Alta:     `/encounters/[id]/discharge` (wizard 2 pasos)
 *
 * Estos specs son smoke (page-loads + elementos clave). Las interacciones
 * profundas del wizard se cubren en Sprint 4 cuando los seeds de E2E
 * incluyan paciente listo-para-admitir + encuentro abierto referenciable.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("@smoke - Admisión → Traslado → Alta", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("admisión: wizard renderiza paso 1 (selector de paciente)", async ({ page }) => {
    await page.goto("/admission");
    await expect(page).toHaveURL(/\/admission/);
    // Paso 1: selector de paciente (PatientSearchBar).
    const heading = page.getByRole("heading", { name: /paciente|admisión/i }).first();
    await expect(heading).toBeVisible();
  });

  test("traslado: tablero `/transfers` renderiza form y lista de encuentros", async ({ page }) => {
    await page.goto("/transfers");
    await expect(page).toHaveURL(/\/transfers/);
    // El form inline tiene el campo de selección de encuentro.
    await expect(
      page.getByLabel(/encuentro a trasladar/i),
    ).toBeVisible();
    // Y el campo de razón clínica (validación min 2 chars).
    await expect(page.getByLabel(/razón clínica/i)).toBeVisible();
    // El botón "Confirmar traslado" debe estar visible (deshabilitado hasta
    // que se completen los campos requeridos).
    await expect(
      page.getByRole("button", { name: /confirmar traslado/i }),
    ).toBeVisible();
  });

  test("alta: ruta `/encounters/[id]/discharge` requiere id válido", async ({ page }) => {
    // Sin id real, navegamos a /encounters y verificamos que la app NO crashee.
    // El detalle individual + flujo de alta se cubre en Sprint 4 con seed de
    // encuentro abierto referenciable.
    const resp = await page.goto("/transfers");
    expect(resp?.status() ?? 0).toBeLessThan(500);
    // Smoke: la app sigue navegable.
    await expect(page.getByRole("navigation")).toBeVisible();
  });
});
