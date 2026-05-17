/**
 * E2E — ECE Atención de Emergencia (ATN_EMERG).
 *
 * Cubre:
 *   AE-01: listado renderiza cabecera y filtro episodio.
 *   AE-02: botón "Nueva atención" navega al formulario.
 *   AE-03: formulario contiene las 4 secciones clínicas.
 *   AE-04: botón "Cancelar" regresa al listado.
 *
 * Nota: Las pruebas de mutación (create/firmar/validar) requieren seed con
 * personal_salud activo. Se marcan .skip en CI dummy siguiendo la convención
 * del proyecto (ver ece-evolucion.spec.ts y ece-signos-vitales.spec.ts).
 *
 * @QA automatizar full flow:
 *   - Login como qa.triagist@his.test (rol MT) → crear atención → firmar → validar.
 *   - Login como qa.admin@his.test (rol DIR) → anular atención pre-validada.
 *   - Verificar que estado "validado" bloquea el botón "Anular".
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const ROUTE_LIST = "/ece/atencion-emergencia";
const ROUTE_NUEVA = "/ece/atencion-emergencia/nueva";

test.describe("ECE — Atención de Emergencia", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("AE-01: listado renderiza cabecera y filtro episodio", async ({ page }) => {
    await page.goto(ROUTE_LIST);

    await expect(
      page.getByRole("heading", { name: /atención de emergencia/i }),
    ).toBeVisible();

    // Filtro episodio accesible
    await expect(page.getByLabel(/episodio/i)).toBeVisible();

    // Botón nueva atención
    await expect(
      page.getByRole("link", { name: /nueva atención/i }),
    ).toBeVisible();
  });

  test("AE-02: botón nueva atención navega al formulario", async ({ page }) => {
    await page.goto(ROUTE_LIST);

    await page.getByRole("link", { name: /nueva atención/i }).click();

    await expect(page).toHaveURL(ROUTE_NUEVA);
    await expect(
      page.getByRole("heading", { name: /nueva atención de emergencia/i }),
    ).toBeVisible();
  });

  test("AE-03: formulario contiene las 4 secciones clínicas", async ({ page }) => {
    await page.goto(ROUTE_NUEVA);

    // Sección 1 — Motivo de consulta
    await expect(page.getByLabel(/motivo de consulta/i)).toBeVisible();

    // Sección 2 — Exploración física
    await expect(page.getByLabel(/exploración física/i)).toBeVisible();

    // Sección 3 — Diagnóstico
    await expect(page.getByLabel(/diagnóstico/i)).toBeVisible();

    // Sección 4 — Plan terapéutico
    await expect(page.getByLabel(/plan terapéutico/i)).toBeVisible();
  });

  test("AE-04: botón Cancelar regresa al historial del navegador", async ({ page }) => {
    await page.goto(ROUTE_LIST);
    await page.goto(ROUTE_NUEVA);

    await page.getByRole("button", { name: /cancelar/i }).click();

    // Debe regresar a la página anterior (listado)
    await expect(page).toHaveURL(ROUTE_LIST);
  });
});
