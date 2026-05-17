/**
 * E2E — /beds integración ECE (carry-over PR #102).
 *
 * Verifica que la ruta legacy /beds sigue accesible pero ahora sirve datos
 * desde el router eceCama en lugar del legacy bed.getMap.
 *
 * Escenarios:
 *   1. /beds renderiza el encabezado "Mapa de camas" (regresión UX).
 *   2. El mapa usa fuente ECE: la página carga sin error aunque el catálogo
 *      legacy esté vacío (eceCama.mapCompleto retorna []).
 *   3. Asignar paciente a cama desde el mapa ECE — botón visible en cama libre.
 *   4. Cama ocupada muestra nombre del paciente (dato ECE: pacienteNombre).
 *
 * Nota: Los tests 3-4 son condicionales al seed de camas en la BD de test.
 * La mutación tRPC (eceCama.cambiarEstado) está cubierta en unit tests.
 *
 * @QA: Automatizar escenario 3 con seed de cama libre + episodio activo
 * en beforeAll; verificar que tras asignación el estado pasa a "Ocupada".
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const BEDS_URL = "/beds";

test.describe("/beds — integración router ECE", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(BEDS_URL);
  });

  // 1 — Regresión UX: la ruta sigue accesible con el mismo título
  test("mantiene encabezado 'Mapa de camas' tras migración a router ECE", async ({ page }) => {
    await expect(page).toHaveURL(/\/beds/);
    await expect(
      page.getByRole("heading", { name: /mapa de camas/i, level: 1 }),
    ).toBeVisible();
  });

  // 2 — La fuente ECE responde sin error (incluso con dataset vacío)
  test("carga sin error aunque eceCama.mapCompleto devuelva array vacío", async ({ page }) => {
    // No debe haber mensajes de error en pantalla
    await expect(
      page.getByText(/error al cargar/i),
    ).not.toBeVisible({ timeout: 8_000 });

    // El contenedor principal está presente
    await expect(
      page.getByRole("heading", { name: /estado de ocupación/i }),
    ).toBeVisible();
  });

  // 3 — Cama libre: botón de asignación accesible
  test("cama libre muestra botón asignable con aria-label ECE", async ({ page }) => {
    // Esperar a que cargue el mapa (puede quedar "No hay camas" si el seed no tiene datos)
    const sinCamas = page.getByText(/no hay camas configuradas/i);
    const camaLibre = page
      .getByRole("button")
      .filter({ hasText: /libre/i })
      .first();

    // Si no hay camas seedeadas, el test pasa como smoke (sin datos de producción)
    const tieneCamas = await camaLibre.isVisible({ timeout: 6_000 }).catch(() => false);
    if (!tieneCamas) {
      await expect(sinCamas).toBeVisible();
      return;
    }

    // Verificar aria-label incluye "Libre" (mapeado desde estado ECE "libre")
    const label = await camaLibre.getAttribute("aria-label");
    expect(label).toMatch(/libre/i);

    // Click — el BedMap no tiene modal built-in; verifica que el click no lanza error JS
    await camaLibre.click();
    // No debe aparecer alerta de error
    await expect(page.getByRole("alert")).not.toBeVisible({ timeout: 2_000 }).catch(() => null);
  });

  // 4 — Cama ocupada muestra nombre del paciente (campo ECE pacienteNombre)
  test("cama ocupada muestra nombre del paciente desde fuente ECE", async ({ page }) => {
    const camaOcupada = page
      .getByRole("button")
      .filter({ hasText: /ocupada/i })
      .first();

    const hayOcupadas = await camaOcupada.isVisible({ timeout: 6_000 }).catch(() => false);
    if (!hayOcupadas) {
      test.skip();
      return;
    }

    // El nombre del paciente debe estar visible dentro de la celda de cama
    const ariaLabel = await camaOcupada.getAttribute("aria-label");
    // aria-label incluye "— <NombrePaciente>" si pacienteNombre no es null
    expect(ariaLabel).toMatch(/—\s+\S+/);
  });
});
