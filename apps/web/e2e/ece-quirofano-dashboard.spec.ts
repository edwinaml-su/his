/**
 * E2E — Dashboard Quirófano (ECE).
 *
 * Spec 1: Página carga con h1 correcto y sección KPIs visible.
 * Spec 2: Mosaico de salas renderiza cards con estado accesible.
 * Spec 3: Cronograma tabla accesible con encabezados de columna.
 * Spec 4: Alertas operacionales anunciadas en live region.
 *
 * Playwright config: fullyParallel=false, workers=1, locale=es-SV.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const QUIROFANO_URL = "/ece/quirofano";

test.describe("ECE — Dashboard Quirófano", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(QUIROFANO_URL);
  });

  // 1 — Carga de página y KPIs
  test("renderiza h1 'Dashboard Quirófano' y sección KPIs", async ({ page }) => {
    await expect(page).toHaveURL(/\/ece\/quirofano/);
    await expect(
      page.getByRole("heading", { name: /dashboard quirófano/i, level: 1 }),
    ).toBeVisible();

    // Sección KPIs con aria-label
    const kpiSection = page.getByRole("region", {
      name: /indicadores del día/i,
    });
    await expect(kpiSection).toBeVisible();

    // Los cuatro KPIs deben existir como listitem
    const items = kpiSection.getByRole("listitem");
    await expect(items).toHaveCount(4);
  });

  // 2 — Mosaico de salas accesible
  test("mosaico tiene role=grid y cards con aria-label de sala", async ({ page }) => {
    const grid = page.getByRole("grid", {
      name: /mosaico de salas quirúrgicas/i,
    });
    await expect(grid).toBeVisible();

    // Al menos una celda visible
    const firstCell = grid.getByRole("gridcell").first();
    await expect(firstCell).toBeVisible();

    // El botón de la primera sala tiene aria-label descriptivo (comienza con "Sala")
    const firstBtn = firstCell.getByRole("button").first();
    await expect(firstBtn).toHaveAttribute("aria-label", /^Sala /i);
  });

  // 3 — Tabla de cronograma accesible
  test("cronograma renderiza tabla con caption y encabezados de columna", async ({
    page,
  }) => {
    const section = page.getByRole("region", {
      name: /cronograma/i,
    });
    await expect(section).toBeVisible();

    // caption para lectores de pantalla
    const caption = section.locator("caption");
    await expect(caption).toBeVisible();
    await expect(caption).toContainText(/cronograma quirúrgico/i);

    // Encabezados de columna (th[scope=col])
    const colHeaders = section.locator("th[scope='col']");
    await expect(colHeaders.first()).toBeVisible();
    // Al menos Hora, Sala, Paciente presentes
    const headerTexts = await colHeaders.allTextContents();
    expect(headerTexts.some((t) => /hora/i.test(t))).toBeTruthy();
    expect(headerTexts.some((t) => /sala/i.test(t))).toBeTruthy();
    expect(headerTexts.some((t) => /paciente/i.test(t))).toBeTruthy();
  });

  // 4 — Alertas con live region y sidebar con nueva sección
  test("alertas están en live region y sidebar tiene sección ECE — Quirófano", async ({
    page,
  }) => {
    // role=alert es suficiente para aria-live — WCAG 2.2 §4.1.3
    const alertRegion = page.getByRole("alert").first();
    await expect(alertRegion).toBeVisible();

    // Al menos un item de alerta visible
    const firstAlerta = alertRegion.getByRole("listitem").first();
    await expect(firstAlerta).toBeVisible();

    // Sidebar con nueva sección y link al dashboard quirófano
    const nav = page.getByRole("navigation", { name: /principal/i });
    const dashboardLink = nav.getByRole("link", {
      name: /dashboard quirófano/i,
    });
    await expect(dashboardLink).toBeVisible();
    await expect(dashboardLink).toHaveAttribute("href", QUIROFANO_URL);
  });
});
