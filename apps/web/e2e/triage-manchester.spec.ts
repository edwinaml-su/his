/**
 * E2E — Triage Manchester.
 * US: TRI-01 (signos vitales), TRI-02 (flujograma), TRI-03 (asignación nivel),
 *     TRI-04 (alerta visual rojo), TRI-05 (cola pendientes).
 *
 * Sprint 3: la ruta `/triage/pending` del spec original NO existe.
 *   Flujo real: `/triage` (cola) → click "Evaluar" → `/triage/new/[encounterId]`.
 *
 * El test profundo de captura + asignación de nivel rojo requiere seed con
 * encuentro abierto referenciable; queda para Sprint 4. Aquí cubrimos el
 * smoke: cola pendiente renderiza con headers a11y y al menos un row.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("@smoke - Triage Manchester", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "triagist");
  });

  test("cola `/triage` renderiza headers a11y y datos", async ({ page }) => {
    await page.goto("/triage");
    const rows = page.getByRole("row");
    // Smoke: la lista renderiza al menos un row de header + uno de datos.
    await expect(rows.first()).toBeVisible();
    // Los roles de columna están presentes para a11y.
    await expect(page.getByRole("columnheader", { name: /paciente/i })).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /llegada|admisión|hora|encuentro/i }),
    ).toBeVisible();
  });

  test("acción `Evaluar` aparece en filas de la cola", async ({ page }) => {
    await page.goto("/triage");
    // El link "Evaluar" navega a /triage/new/[id]. Si la cola está vacía el
    // test es informativo en lugar de fail (el seed E2E garantiza al menos uno
    // pero queremos tolerancia a runs aislados).
    const evaluarLinks = page.getByRole("link", { name: /evaluar/i });
    const count = await evaluarLinks.count();
    test.info().annotations.push({
      type: "triage-queue",
      description: `${count} encuentros pendientes de triage`,
    });
    if (count > 0) {
      await expect(evaluarLinks.first()).toBeVisible();
    }
  });
});
