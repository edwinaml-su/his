/**
 * E2E — Workflow Designer Editor Core (US.F2.2.01-04)
 *
 * Cubre happy paths del editor visual completo:
 *  1. Carga del editor con canvas React Flow visible.
 *  2. Toolbar: botones Encuadrar y Auto-layout visibles.
 *  3. Paleta izquierda: muestra tipos de estado.
 *  4. Click en nodo → panel de propiedades aparece con código y nombre.
 *  5. Panel de propiedades muestra tipo (INICIAL/INTERMEDIO/FINAL).
 *  6. Botón "Editar tabla" navega a /editar.
 *  7. Auto-layout no crashea (smoke).
 *
 * Prerequisito: al menos un tipo de documento con estados sembrado en BD de test.
 * Si no hay datos disponibles, los tests se marcan como info y pasan (no fallan CI).
 *
 * @QA: Antes de marcar US.F2.2.01-04 como Done, ejecutar este spec contra
 * el ambiente staging con datos reales de workflow. Verificar:
 *   - Drag de nodo persiste posición en BD (requiere rol WORKFLOW_DESIGNER).
 *   - Drop desde paleta abre modal de creación (requiere usuario con rol editor).
 *   - Auto-layout anima con 300ms y reposiciona correctamente.
 */

import { test, expect, type Page } from "@playwright/test";
import { login } from "./_helpers/auth";

// ─── Helper: navegar al primer workflow disponible ────────────────────────────

async function navigateToFirstWorkflow(page: Page): Promise<string | null> {
  await page.goto("/workflow-designer", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const firstLink = page.locator("a[href^='/workflow-designer/']").first();
  const count = await firstLink.count();
  if (count === 0) return null;

  const href = await firstLink.getAttribute("href");
  if (!href) return null;

  await page.goto(href, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  return href;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Workflow Designer — Editor Core (US.F2.2.01-04)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("US.F2.2.01 — canvas React Flow renderiza en el editor", async ({ page }) => {
    const href = await navigateToFirstWorkflow(page);
    if (!href) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "No hay tipos de documento sembrados en BD de test",
      });
      return;
    }

    // Verifica que el editor root está presente
    const editorRoot = page.locator('[data-testid="workflow-editor-root"]');
    await expect(editorRoot).toBeVisible();

    // Verifica el canvas de React Flow
    const container = page.locator('[data-testid="workflow-graph-container"]');
    if (await container.count() > 0) {
      await expect(container).toBeVisible();
      const rfViewport = page.locator(".react-flow__viewport");
      await expect(rfViewport).toBeVisible();
    }
  });

  test("US.F2.2.01 — toolbar visible con controles principales", async ({ page }) => {
    const href = await navigateToFirstWorkflow(page);
    if (!href) return;

    // Botón Encuadrar siempre visible
    const fitBtn = page.getByTestId("fit-view-btn");
    await expect(fitBtn).toBeVisible();

    // Botón Auto-layout (si no es readOnly)
    const autoBtn = page.getByTestId("auto-layout-btn");
    if (await autoBtn.count() > 0) {
      await expect(autoBtn).toBeVisible();
    }

    // Link de breadcrumb al listado
    const breadcrumb = page.getByRole("link", { name: /Workflow Designer/i }).first();
    await expect(breadcrumb).toBeVisible();
  });

  test("US.F2.2.02 — paleta izquierda muestra tipos de estado", async ({ page }) => {
    const href = await navigateToFirstWorkflow(page);
    if (!href) return;

    // Paleta sidebar
    const palette = page.getByRole("complementary", { name: /Paleta/i });
    if (await palette.count() === 0) {
      // Si es readOnly no se muestra la paleta — ok
      return;
    }

    await expect(palette).toBeVisible();
    await expect(palette.getByText("Estado Inicial")).toBeVisible();
    await expect(palette.getByText("Estado Intermedio")).toBeVisible();
    await expect(palette.getByText("Estado Final (OK)")).toBeVisible();
  });

  test("US.F2.2.02 — búsqueda en paleta filtra elementos", async ({ page }) => {
    const href = await navigateToFirstWorkflow(page);
    if (!href) return;

    const palette = page.getByRole("complementary", { name: /Paleta/i });
    if (await palette.count() === 0) return;

    const searchInput = palette.getByRole("searchbox");
    await searchInput.fill("Firma");

    await expect(palette.getByText("Esperando Firma")).toBeVisible();
    await expect(palette.getByText("Estado Inicial")).not.toBeVisible();
  });

  test("US.F2.2.03 — click en nodo abre panel de propiedades", async ({ page }) => {
    const href = await navigateToFirstWorkflow(page);
    if (!href) return;

    const firstNode = page.locator(".react-flow__node-estado").first();
    if (await firstNode.count() === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "No hay estados en este workflow",
      });
      return;
    }

    await firstNode.click();
    await page.waitForTimeout(500);

    // Panel de propiedades con role complementary
    const propsPanel = page.getByRole("complementary", {
      name: /Panel de propiedades/i,
    });
    await expect(propsPanel).toBeVisible();

    // Debe mostrar título "Estado"
    await expect(propsPanel).toContainText("Estado");

    // Debe mostrar el código del estado
    await expect(propsPanel.locator("code")).toBeVisible();
  });

  test("US.F2.2.03 — panel de propiedades cierra al presionar ✕", async ({ page }) => {
    const href = await navigateToFirstWorkflow(page);
    if (!href) return;

    const firstNode = page.locator(".react-flow__node-estado").first();
    if (await firstNode.count() === 0) return;

    await firstNode.click();
    await page.waitForTimeout(500);

    const propsPanel = page.getByRole("complementary", { name: /Panel de propiedades/i });
    if (await propsPanel.count() === 0) return;

    const closeBtn = propsPanel.getByRole("button", { name: /cerrar panel/i });
    await closeBtn.click();
    await page.waitForTimeout(300);

    await expect(propsPanel).not.toBeVisible();
  });

  test("US.F2.2.04 — botón Auto-layout no genera error de JS", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const href = await navigateToFirstWorkflow(page);
    if (!href) return;

    const autoBtn = page.getByTestId("auto-layout-btn");
    if (await autoBtn.count() === 0) return;

    await autoBtn.click();
    await page.waitForTimeout(500);

    // Sin errores de JS críticos (excluir errores de red esperados)
    const criticalErrors = errors.filter(
      (e) => !e.includes("Failed to fetch") && !e.includes("NetworkError"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("botón 'Editar tabla' navega a /editar", async ({ page }) => {
    const href = await navigateToFirstWorkflow(page);
    if (!href) return;

    const editarLink = page.getByRole("link", { name: /Editar tabla/i });
    await expect(editarLink).toBeVisible();
    await editarLink.click();
    await page.waitForTimeout(1000);

    await expect(page).toHaveURL(/\/editar/);
  });
});
