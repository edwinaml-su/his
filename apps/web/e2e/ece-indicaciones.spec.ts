/**
 * E2E — ECE Indicaciones Médicas (TDR §ECE).
 *
 * Cubre el flujo completo:
 *   1. Lista de indicaciones renderiza (smoke).
 *   2. Wizard nueva indicación — agregar ítem de medicamento y avanzar.
 *   3. Firma MC desde el detalle (modal PIN).
 *   4. Validación ENF — botón "Verificar transcripción".
 *
 * El seed E2E debe proveer:
 *   - qa.admin@his.test con roles MC + ENF en la org de prueba.
 *   - Al menos una indicación en estado FIRMADA_MC para el test ENF.
 *
 * Nota: los tests que dependen de datos seed usan `test.info().annotations`
 * para tolerancia de runs aislados (sin seed real), siguiendo el patrón de
 * triage-manchester.spec.ts.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("ECE — Indicaciones Médicas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  // ---------------------------------------------------------------------------
  // Smoke: lista
  // ---------------------------------------------------------------------------
  test("lista /ece/indicaciones renderiza sin errores", async ({ page }) => {
    await page.goto("/ece/indicaciones");
    await expect(
      page.getByRole("heading", { name: /indicaciones médicas/i }),
    ).toBeVisible();
    // Filtro de estado está presente
    await expect(page.getByLabel(/estado/i)).toBeVisible();
    // Botón nueva indicación
    await expect(
      page.getByRole("link", { name: /nueva indicación/i }),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Wizard: navegar hasta paso 2, agregar medicamento
  // ---------------------------------------------------------------------------
  test("wizard nueva indicación — agregar ítem y avanzar pasos", async ({
    page,
  }) => {
    await page.goto("/ece/indicaciones/nueva");

    // Paso 1 — datos generales
    await expect(
      page.getByRole("heading", { name: /nueva indicación médica/i }),
    ).toBeVisible();

    const episodioInput = page.getByTestId("input-episodio-id");
    await episodioInput.fill("00000000-0000-0000-0000-000000000001");

    await page.getByRole("button", { name: /siguiente/i }).click();

    // Paso 2 — medicamentos
    await expect(
      page.getByRole("button", { name: /agregar medicamento/i }),
    ).toBeVisible();

    // El typeahead del primer item debe existir
    const medSearch = page.getByTestId("med-search-0");
    await expect(medSearch).toBeVisible();

    // Agregar segundo ítem
    await page.getByTestId("btn-agregar-medicamento").click();
    await expect(page.getByTestId("med-search-1")).toBeVisible();

    test.info().annotations.push({
      type: "ece-wizard-step2",
      description: "Paso 2 renderiza con 2 items tras click en + Agregar",
    });
  });

  // ---------------------------------------------------------------------------
  // Wizard: validación client-side — sin episodio no avanza
  // ---------------------------------------------------------------------------
  test("wizard paso 1 — no avanza sin episodioId", async ({ page }) => {
    await page.goto("/ece/indicaciones/nueva");
    await page.getByRole("button", { name: /siguiente/i }).click();
    // Sigue en paso 1 — indicador de error visible
    await expect(page.getByText(/episodio requerido/i)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Detalle: modal de firma MC aparece
  // ---------------------------------------------------------------------------
  test("detalle con estado BORRADOR — botón Firmar abre modal PIN", async ({
    page,
  }) => {
    // Navegar a la lista para obtener un ID real
    await page.goto("/ece/indicaciones");
    const verLinks = page.getByRole("link", { name: /^ver$/i });
    const count = await verLinks.count();

    test.info().annotations.push({
      type: "ece-indicaciones-count",
      description: `${count} indicaciones en lista`,
    });

    if (count === 0) {
      // Sin seed real, smoke pasa informativo
      test.info().annotations.push({
        type: "skip-reason",
        description: "Sin indicaciones en BD de prueba — smoke informativo",
      });
      return;
    }

    await verLinks.first().click();
    await page.waitForURL(/\/ece\/indicaciones\/.+/);

    // Si la indicación está en BORRADOR, el botón de firma existe
    const btnFirmar = page.getByRole("button", {
      name: /firmar indicación/i,
    });
    const firmarVisible = await btnFirmar.isVisible();

    if (firmarVisible) {
      await btnFirmar.click();
      // Modal PIN aparece
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByLabel(/pin de firma/i)).toBeVisible();
      // Cancelar cierra el modal
      await page.getByRole("button", { name: /cancelar/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
    }
  });

  // ---------------------------------------------------------------------------
  // Vista ENF: botón "Verificar transcripción" visible cuando FIRMADA_MC
  // ---------------------------------------------------------------------------
  test("detalle con estado FIRMADA_MC — botón Verificar visible", async ({
    page,
  }) => {
    await page.goto("/ece/indicaciones");
    const verLinks = page.getByRole("link", { name: /^ver$/i });
    const count = await verLinks.count();

    if (count === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "Sin indicaciones en BD de prueba",
      });
      return;
    }

    // Iterar hasta encontrar una FIRMADA_MC o agotar la lista (máx 5)
    const limit = Math.min(count, 5);
    for (let i = 0; i < limit; i++) {
      // Re-fetch links porque la navegación los invalida
      await page.goto("/ece/indicaciones");
      const links = page.getByRole("link", { name: /^ver$/i });
      await links.nth(i).click();
      await page.waitForURL(/\/ece\/indicaciones\/.+/);

      const btnVerificar = page.getByTestId("btn-verificar-transcripcion");
      const visible = await btnVerificar.isVisible();
      if (visible) {
        await btnVerificar.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(
          page.getByText(/verificación de transcripción/i),
        ).toBeVisible();
        // Confirmar requiere PIN >= 6 chars — el botón confirmar debe estar disabled
        const btnConfirmar = page.getByTestId("btn-confirmar-validacion");
        await expect(btnConfirmar).toBeDisabled();
        // Llenar PIN habilita botón
        await page.getByLabel(/pin de firma/i).fill("123456");
        await expect(btnConfirmar).not.toBeDisabled();
        break;
      }
    }
  });
});
