/**
 * E2E — GS1 Catálogos admin UI (US.F2.6.3-5).
 *
 * Cubre los tres sub-módulos:
 *   1. /gs1/gln      — árbol GLN y formulario de alta.
 *   2. /gs1/medicamentos — tabla GTIN con filtros.
 *   3. /gs1/dashboard   — cards de conteo e integridad.
 *
 * Pre-condición: el sidebar GS1 Logística debe estar accesible para ADMIN.
 *
 * Nota: los tests de mutación (alta GLN, edición medicamento, markRecall)
 * se marcan con .skip si la BD de CI no tiene los fixtures GS1 sembrados.
 * El gate es la visibilidad de las rutas y el estructura básica de UI.
 */

import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("GS1 Catálogos — admin UI", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  // ─── GLN Ubicaciones ────────────────────────────────────────────────────

  test.describe("GLN Ubicaciones (/gs1/gln)", () => {
    test("la página carga y muestra el encabezado", async ({ page }) => {
      await page.goto("/gs1/gln");

      await expect(page.getByRole("heading", { name: /gln/i })).toBeVisible();
      await expect(
        page.getByText(/jerarquía de ubicaciones/i),
      ).toBeVisible();
    });

    test("botón Nueva raíz GLN abre el dialog de alta", async ({ page }) => {
      await page.goto("/gs1/gln");

      const btn = page.getByTestId("btn-nuevo-gln-raiz");
      await expect(btn).toBeVisible();
      await btn.click();

      // El dialog debe aparecer con el campo de código GLN.
      await expect(page.getByTestId("input-gln-codigo")).toBeVisible();
    });

    test("el dialog valida un código GLN-13 inválido", async ({ page }) => {
      await page.goto("/gs1/gln");
      await page.getByTestId("btn-nuevo-gln-raiz").click();

      const codigoInput = page.getByTestId("input-gln-codigo");
      await codigoInput.fill("12345");  // Demasiado corto.
      await page.getByTestId("btn-gln-guardar").click();

      // Debe aparecer un mensaje de error de validación.
      await expect(page.getByText(/13 dígitos|verificador|inválido/i)).toBeVisible();
    });

    test("panel detalle se muestra vacío sin selección", async ({ page }) => {
      await page.goto("/gs1/gln");

      await expect(
        page.getByText(/selecciona un nodo del árbol/i),
      ).toBeVisible();
    });

    test("árbol GLN tiene role=tree (a11y)", async ({ page }) => {
      await page.goto("/gs1/gln");

      // Puede estar vacío pero el elemento role=tree debe existir o el status vacío.
      const tree = page.getByRole("tree");
      const emptyMsg = page.getByText(/sin ubicaciones gln registradas/i);

      const treeVisible  = await tree.isVisible().catch(() => false);
      const emptyVisible = await emptyMsg.isVisible().catch(() => false);

      expect(treeVisible || emptyVisible).toBe(true);
    });
  });

  // ─── Medicamentos GTIN ───────────────────────────────────────────────────

  test.describe("Medicamentos GTIN (/gs1/medicamentos)", () => {
    test("la página carga y muestra el encabezado", async ({ page }) => {
      await page.goto("/gs1/medicamentos");

      await expect(
        page.getByRole("heading", { name: /medicamentos gtin/i }),
      ).toBeVisible();
      await expect(page.getByText(/catálogo gs1-14/i)).toBeVisible();
    });

    test("el filtro de recall existe y es seleccionable", async ({ page }) => {
      await page.goto("/gs1/medicamentos");

      const filterRecall = page.getByTestId("filter-recall");
      await expect(filterRecall).toBeVisible();
    });

    test("el filtro de vencimiento existe", async ({ page }) => {
      await page.goto("/gs1/medicamentos");

      const filterVenc = page.getByTestId("filter-vencimiento");
      await expect(filterVenc).toBeVisible();
    });

    test("la tabla o el estado vacío son visibles", async ({ page }) => {
      await page.goto("/gs1/medicamentos");

      // Esperar que cargue (loading desaparece).
      await expect(
        page.getByText(/cargando medicamentos/i),
      ).not.toBeVisible({ timeout: 8_000 });

      const table = page.getByRole("table", { name: /catálogo de medicamentos gtin/i });
      const emptyMsg = page.getByText(/sin medicamentos que coincidan/i);
      const tableVisible = await table.isVisible().catch(() => false);
      const emptyVisible = await emptyMsg.isVisible().catch(() => false);

      expect(tableVisible || emptyVisible).toBe(true);
    });
  });

  // ─── Dashboard GS1 ──────────────────────────────────────────────────────

  test.describe("Dashboard GS1 (/gs1/dashboard)", () => {
    test("la página carga y muestra el encabezado", async ({ page }) => {
      await page.goto("/gs1/dashboard");

      await expect(
        page.getByRole("heading", { name: /dashboard gs1/i }),
      ).toBeVisible();
    });

    test("las tres cards de conteo están visibles", async ({ page }) => {
      await page.goto("/gs1/dashboard");

      // Esperar que los spinners desaparezcan.
      await page.waitForTimeout(1500);

      await expect(page.getByText(/gsrn activos/i)).toBeVisible();
      await expect(page.getByText(/gln registrados/i)).toBeVisible();
      await expect(page.getByText(/gtin con lotes/i)).toBeVisible();
    });

    test("el selector de ventana de vencimientos funciona", async ({ page }) => {
      await page.goto("/gs1/dashboard");

      const selector = page.getByTestId("select-vencimientos");
      await expect(selector).toBeVisible();
      await selector.selectOption("90");
      await expect(page.getByText(/vencimientos próximos.*90 días/i)).toBeVisible();
    });

    test("el botón refrescar está accesible", async ({ page }) => {
      await page.goto("/gs1/dashboard");

      await expect(page.getByTestId("btn-refrescar")).toBeVisible();
    });

    test("tabla de vencimientos o estado vacío son visibles", async ({ page }) => {
      await page.goto("/gs1/dashboard");
      await page.waitForTimeout(1500);

      const table = page.getByRole("table", { name: /medicamentos con vencimiento próximo/i });
      const emptyMsg = page.getByText(/sin vencimientos en los próximos/i);

      const tableVisible = await table.isVisible().catch(() => false);
      const emptyVisible = await emptyMsg.isVisible().catch(() => false);

      expect(tableVisible || emptyVisible).toBe(true);
    });
  });

  // ─── Sidebar GS1 Logística ───────────────────────────────────────────────

  test("sidebar muestra sección GS1 Logística con los 3 links nuevos", async ({ page }) => {
    await page.goto("/dashboard");

    const nav = page.getByRole("navigation");

    // La sección puede estar colapsada — buscar el texto primero.
    const gs1Section = nav.getByText(/gs1 logística/i);
    if (await gs1Section.isVisible()) {
      await gs1Section.click();
    }

    await expect(nav.getByRole("link", { name: /gln ubicaciones/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /medicamentos gtin/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /dashboard gs1/i })).toBeVisible();
  });
});
