/**
 * E2E — ECE Mapa de Camas.
 *
 * Smoke tests del flujo principal:
 *   1. La página carga con encabezado correcto.
 *   2. El selector de servicio está presente y funcional.
 *   3. El sidebar contiene "Mapa de Camas" bajo "ECE — Hospitalario".
 *   4. Las métricas se renderizan en la zona de estado.
 *   5. El grid de camas es navegable por teclado (WCAG 2.2 AA).
 *   6. Click en cama libre abre modal "Asignar paciente".
 *   7. El modal de asignación tiene los controles accesibles requeridos.
 *
 * Nota: el flujo completo de asignación a BD requiere seed de camas con
 * ward real en Supabase. Los tests 6-7 validan UI/UX; la mutación tRPC
 * se cubre en los unit tests del router.
 *
 * Playwright config: fullyParallel=false, workers=1, locale=es-SV.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const MAPA_URL = "/ece/camas";

test.describe("ECE — Mapa de Camas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(MAPA_URL);
  });

  // 1 — Página carga
  test("renderiza encabezado 'Mapa de Camas'", async ({ page }) => {
    await expect(page).toHaveURL(/\/ece\/camas/);
    await expect(
      page.getByRole("heading", { name: /mapa de camas/i, level: 1 }),
    ).toBeVisible();
  });

  // 2 — Selector de servicio
  test("selector de servicio está visible y tiene opciones", async ({ page }) => {
    const selector = page.getByRole("combobox", { name: /servicio/i });
    await expect(selector).toBeVisible();

    // Abrir el select y verificar que hay al menos una opción
    await selector.click();
    const opciones = page.getByRole("option");
    await expect(opciones.first()).toBeVisible();
    // Cerrar con Escape
    await page.keyboard.press("Escape");
  });

  // 3 — Sidebar contiene el item
  test("sidebar contiene 'Mapa de Camas' bajo 'ECE — Hospitalario'", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: /principal/i });
    await expect(nav).toBeVisible();
    const link = nav.getByRole("link", { name: /mapa de camas/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", MAPA_URL);
  });

  // 4 — Métricas presentes
  test("muestra zona de métricas con badge 'Total'", async ({ page }) => {
    // role=status con aria-label="Métricas del servicio"
    const metricasZone = page.getByRole("status", { name: /métricas del servicio/i });
    await expect(metricasZone).toBeVisible({ timeout: 10_000 });
    // Al menos el badge "Total" debe estar visible
    await expect(metricasZone.getByText(/total/i)).toBeVisible();
  });

  // 5 — Grid accesible por teclado
  test("grid de camas tiene role=grid y celdas enfocables por teclado", async ({ page }) => {
    const grid = page.getByRole("grid", { name: /mapa de camas del servicio/i });
    // Puede estar en estado loading (skeleton) o con datos
    await expect(grid).toBeVisible({ timeout: 10_000 });

    // Si hay celdas (no solo esqueletos), la primera debe ser focusable
    const primeracelda = grid.getByRole("gridcell").first();
    const primerBoton = primeracelda.getByRole("button").first();
    if (await primerBoton.isVisible()) {
      await primerBoton.focus();
      await expect(primerBoton).toBeFocused();
    }
  });

  // 6 — Click en cama libre abre modal asignar
  test("click en cama libre abre modal 'Asignar paciente'", async ({ page }) => {
    // Esperar grid con datos
    const grid = page.getByRole("grid", { name: /mapa de camas del servicio/i });
    await expect(grid).toBeVisible({ timeout: 10_000 });

    // Buscar una celda con aria-label que contenga "Libre"
    const camaLibre = grid
      .getByRole("button")
      .filter({ hasText: /libre/i })
      .first();

    // Si no hay camas libres en el seed, solo verificamos que el grid existe
    if (!(await camaLibre.isVisible())) {
      test.skip();
      return;
    }

    await camaLibre.click();

    // Modal debe abrirse
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /asignar paciente/i }),
    ).toBeVisible();
  });

  // 7 — Modal de asignación tiene controles accesibles
  test("modal 'Asignar paciente' tiene campo episodio con label y botón submit", async ({
    page,
  }) => {
    const grid = page.getByRole("grid", { name: /mapa de camas del servicio/i });
    await expect(grid).toBeVisible({ timeout: 10_000 });

    const camaLibre = grid
      .getByRole("button")
      .filter({ hasText: /libre/i })
      .first();

    if (!(await camaLibre.isVisible())) {
      test.skip();
      return;
    }

    await camaLibre.click();

    const dialog = page.getByRole("dialog");
    // Campo con label asociada
    await expect(
      dialog.getByLabel(/id episodio hospitalario/i),
    ).toBeVisible();
    // Botón submit
    await expect(
      dialog.getByRole("button", { name: /asignar/i }),
    ).toBeVisible();
    // Botón cancelar
    await expect(
      dialog.getByRole("button", { name: /cancelar/i }),
    ).toBeVisible();
  });
});
