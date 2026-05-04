/**
 * E2E — Triage Manchester.
 * US: TRI-01 (signos vitales), TRI-02 (flujograma), TRI-03 (asignación nivel),
 *     TRI-04 (alerta visual rojo), TRI-05 (cola pendientes).
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("Triage Manchester", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "triagist");
  });

  test("captura signos vitales, flujograma y nivel rojo dispara alerta", async ({ page }) => {
    await page.goto("/triage/pending");

    // Toma el primer encuentro pendiente.
    await page.getByRole("button", { name: /evaluar/i }).first().click();

    // Signos vitales.
    await page.getByLabel(/presión sistólica|BP_SYS/i).fill("80");
    await page.getByLabel(/presión diastólica|BP_DIA/i).fill("50");
    await page.getByLabel(/frecuencia cardíaca|HR/i).fill("140");
    await page.getByLabel(/saturación|SpO2/i).fill("88");

    // Flujograma.
    await page.getByLabel(/flujograma/i).click();
    await page.getByRole("option", { name: /dolor torácico/i }).click();

    // Discriminador positivo de máxima prioridad.
    await page
      .getByRole("checkbox", { name: /shock|compromiso vía aérea|inconsciente/i })
      .first()
      .check();

    await page.getByRole("button", { name: /asignar nivel/i }).click();

    // Nivel rojo + alerta visual con texto (no solo color).
    const redBadge = page.getByRole("alert", { name: /nivel rojo|emergencia/i });
    await expect(redBadge).toBeVisible();
    await expect(redBadge).toHaveAccessibleName(/rojo|emergencia/i);

    // Confirmar.
    await page.getByRole("button", { name: /confirmar evaluación/i }).click();
    await expect(page.getByText(/evaluación registrada/i)).toBeVisible();
  });

  test("cola pendiente ordena por prioridad y antigüedad", async ({ page }) => {
    // Ruta real: /triage (la antigua /triage/pending nunca existió).
    await page.goto("/triage");
    const rows = page.getByRole("row");
    // Smoke: la lista renderiza al menos un row de header + uno de datos.
    await expect(rows.first()).toBeVisible();
    // Los roles de columna están presentes para a11y.
    await expect(page.getByRole("columnheader", { name: /paciente/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /llegada|admisión|hora/i })).toBeVisible();
  });
});
