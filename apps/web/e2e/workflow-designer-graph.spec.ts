/**
 * E2E — Workflow Designer Graph (ReactFlow)
 *
 * Cubre:
 *  1. Carga del grafo con estados visibles.
 *  2. Click en nodo abre sidebar con detalles del estado.
 *
 * Prerequisito: debe existir al menos un tipo de documento con estados
 * sembrado en la BD de test (o el smoke seed incluye uno).
 * Si no hay workflows sembrados el test lo indica como info y pasa.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("Workflow Designer — Grafo ReactFlow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("lista de tipos de documento carga", async ({ page }) => {
    await page.goto("/workflow-designer", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/workflow-designer/);
    await page.waitForTimeout(1500);
    // Solo verifica que la página cargó sin error 5xx
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  test("grafo carga y muestra el canvas ReactFlow", async ({ page }) => {
    // Navegar al listado para obtener el primer tipo de documento
    await page.goto("/workflow-designer", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Buscar enlace a un workflow concreto
    const firstLink = page.locator("a[href^='/workflow-designer/']").first();
    const count = await firstLink.count();

    if (count === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "No hay tipos de documento sembrados en BD de test",
      });
      return;
    }

    const href = await firstLink.getAttribute("href");
    if (!href) return;

    await page.goto(href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Verifica contenedor del grafo
    const container = page.locator('[data-testid="workflow-graph-container"]');
    await expect(container).toBeVisible();

    // Verifica que ReactFlow renderizó el viewport
    const rfViewport = page.locator(".react-flow__viewport");
    await expect(rfViewport).toBeVisible();
  });

  test("click en nodo abre sidebar con detalles del estado", async ({ page }) => {
    await page.goto("/workflow-designer", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const firstLink = page.locator("a[href^='/workflow-designer/']").first();
    if ((await firstLink.count()) === 0) return;

    const href = await firstLink.getAttribute("href");
    if (!href) return;

    await page.goto(href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Buscar primer nodo custom del grafo
    const firstNode = page
      .locator(".react-flow__node-estado")
      .first();

    if ((await firstNode.count()) === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "No hay estados en este workflow",
      });
      return;
    }

    await firstNode.click();
    await page.waitForTimeout(500);

    // El sidebar debe mostrarse con el título "Estado"
    const sidebar = page.getByRole("complementary", {
      name: /detalles del elemento seleccionado/i,
    });
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toContainText("Estado");

    // Debe tener botón Editar
    await expect(
      sidebar.getByRole("link", { name: /editar/i }),
    ).toBeVisible();
  });
});
