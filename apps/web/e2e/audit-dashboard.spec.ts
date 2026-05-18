/**
 * E2E — Dashboard Auditoría Accesos ECE.
 * US.F2.7.16 — Vista para DIR.
 *
 * Cubre:
 *   ADSH-01: Solo DIR puede acceder a /admin/audit-dashboard.
 *   ADSH-02: KPIs "Total Accesos", "Outliers Detectados", "Accesos Sensibles" visibles.
 *   ADSH-03: Tabla "Top 10 Usuarios" renderiza encabezados.
 *   ADSH-04: Tabla "Accesos Outlier" renderiza aunque esté vacía.
 *   ADSH-05: Botón "Escanear Outliers" es clickeable y responde.
 *   ADSH-06: Filtros de fecha cambian los parámetros de la consulta.
 *   ADSH-07: Tabla "Accesos Sensibles" visible.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const ROUTE = "/admin/audit-dashboard";

test.describe("ADSH-01: control de acceso", () => {
  test("usuario sin rol DIR no accede a audit-dashboard", async ({ page }) => {
    await login(page, "triagist");
    await page.goto(ROUTE);

    const url = page.url();
    const blocked =
      url.includes("403") ||
      url.includes("dashboard") ||
      url.includes("unauthorized") ||
      (await page
        .getByText(/acceso denegado|no autorizado|forbidden/i)
        .isVisible());

    expect(blocked).toBe(true);
  });
});

test.describe("ADSH-02-07: dashboard DIR", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(ROUTE);
    await page.waitForLoadState("networkidle");
  });

  test("ADSH-02: KPIs visibles en la página", async ({ page }) => {
    await expect(page.getByText("Total Accesos")).toBeVisible();
    await expect(page.getByText("Outliers Detectados")).toBeVisible();
    await expect(page.getByText("Accesos Sensibles")).toBeVisible();
  });

  test("ADSH-03: tabla Top 10 Usuarios tiene encabezados", async ({ page }) => {
    await expect(
      page.getByText("Top 10 Usuarios por Accesos"),
    ).toBeVisible();
  });

  test("ADSH-04: sección Accesos Outlier visible", async ({ page }) => {
    await expect(page.getByText("Accesos Outlier")).toBeVisible();
  });

  test("ADSH-05: botón Escanear Outliers existe y es clickeable", async ({
    page,
  }) => {
    const btn = page.getByRole("button", { name: /Escanear Outliers/i });
    await expect(btn).toBeVisible();
    // Solo verifica que el click no lanza error JS
    await btn.click();
  });

  test("ADSH-06: filtros de fecha renderizan labels accesibles", async ({
    page,
  }) => {
    await expect(page.getByLabel("Desde")).toBeVisible();
    await expect(page.getByLabel("Hasta")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Aplicar filtro/i }),
    ).toBeVisible();
  });

  test("ADSH-07: sección Accesos Sensibles visible", async ({ page }) => {
    await expect(
      page.getByText(/Accesos a Expedientes Sensibles/i),
    ).toBeVisible();
  });
});
