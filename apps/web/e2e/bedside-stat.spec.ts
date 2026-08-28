/**
 * E2E — Modo STAT: bypass justificado bedside (US.F2.6.47)
 *
 * `StatActivationDialog` y `StatBanner` se montan en `AdministrationWizard`
 * (`/bedside/[patientId]/[indicationId]`) — antes de este cableado
 * (inventario de componentes huérfanos 2026-08-26, Tier 1) ningún archivo
 * los importaba y esta suite lo admitía en comentario en vez de probarlo.
 * El wizard no consulta el backend por patientId/indicationId hasta que
 * el usuario escanea, así que un UUID de placeholder en la URL basta para
 * ejercitar el chrome del formulario sin depender de seeds de indicación.
 *
 * Lo que se verifica aquí:
 *  - La página /bedside carga y muestra el flujo principal.
 *  - El botón "Activar STAT" es visible en el wizard bedside y abre el diálogo
 *    con motivo/GSRN/testigos.
 *  - Sin sesión STAT activa, el banner `[data-testid='stat-banner']` no se monta.
 *  - El dashboard /audit/stat-events renderiza filtros y tabla.
 */

import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

// Placeholders — el wizard no valida estos IDs contra el backend hasta el
// primer scan, así que no requieren seeds de indicación real.
const DUMMY_PATIENT_ID = "00000000-0000-4000-8000-000000000001";
const DUMMY_INDICATION_ID = "00000000-0000-4000-8000-000000000002";

test.describe("Modo STAT — Bedside bypass justificado", () => {
  test.beforeEach(async ({ page }) => {
    // Usamos qa.triagist@his.test que tiene rol ENF_JEFE/MEDICO en la org de test
    await login(page, "admin");
  });

  test("bedside: página principal carga", async ({ page }) => {
    await page.goto("/bedside");
    await expect(page).toHaveURL(/\/bedside/);
    // La página de bedside tiene un heading o texto de cola
    const content = page.locator("main, [role='main']");
    await expect(content).toBeVisible();
  });

  test("audit/stat-events: dashboard DIR carga y muestra filtros", async ({ page }) => {
    await page.goto("/audit/stat-events");
    await expect(page).toHaveURL(/\/audit\/stat-events/);

    // El heading debe estar presente
    const heading = page.getByRole("heading", { name: /Eventos STAT/i });
    await expect(heading).toBeVisible();

    // Los filtros mes/año deben estar presentes
    const mesSelect = page.locator("#stat-mes");
    await expect(mesSelect).toBeVisible();

    const anioInput = page.locator("#stat-anio");
    await expect(anioInput).toBeVisible();
  });

  test("audit/stat-events: selector de mes tiene 12 opciones", async ({ page }) => {
    await page.goto("/audit/stat-events");
    const mesSelect = page.locator("#stat-mes");
    await expect(mesSelect).toBeVisible();
    const options = mesSelect.locator("option");
    await expect(options).toHaveCount(12);
  });

  test("audit/stat-events: puede cambiar mes y año", async ({ page }) => {
    await page.goto("/audit/stat-events");

    // Cambiar mes a enero
    await page.locator("#stat-mes").selectOption("1");
    await expect(page.locator("#stat-mes")).toHaveValue("1");

    // Cambiar año a 2025
    await page.locator("#stat-anio").fill("2025");
    await expect(page.locator("#stat-anio")).toHaveValue("2025");
  });

  test("stat-activation-dialog: botón Activar STAT abre formulario con campos requeridos", async ({ page }) => {
    await page.goto(`/bedside/${DUMMY_PATIENT_ID}/${DUMMY_INDICATION_ID}`);
    await expect(page).not.toHaveURL(/\/login/);

    const activateButton = page.getByRole("button", { name: /Activar STAT/i });
    await expect(activateButton).toBeVisible();
    await activateButton.click();

    const dialog = page.getByRole("dialog", { name: /Activar Modo STAT/i });
    await expect(dialog).toBeVisible();

    await expect(page.locator("#stat-motivo")).toBeVisible();
    await expect(page.locator("#stat-gsrn-medico")).toBeVisible();
    await expect(page.getByPlaceholder("UUID del testigo")).toBeVisible();
  });

  test("stat-banner: no se monta sin sesión STAT activa", async ({ page }) => {
    // El StatBanner se monta en el wizard bedside cuando hay sesión STAT activa
    // (bedsideStat.getActive). Sin sesión activa para esta indicación, el
    // selector no debe existir en el DOM.
    await page.goto(`/bedside/${DUMMY_PATIENT_ID}/${DUMMY_INDICATION_ID}`);
    const banner = page.locator("[data-testid='stat-banner']");
    await expect(banner).not.toBeVisible();
  });
});
