/**
 * E2E — ECE Lista de Verificación Preoperatoria (PREOP_CHECK).
 *
 * Cubre:
 *   PC-01: listado renderiza cabecera y filtro episodio hospitalario.
 *   PC-02: botón "Nuevo checklist" navega al formulario.
 *   PC-03: formulario contiene los ítems NTEC Art. 28.
 *   PC-04: botón "Cancelar" regresa al listado.
 *   PC-05: detalle de checklist renderiza sección de firma.
 *
 * Las pruebas de mutación (create/firmar) requieren seed con personal_salud
 * activo y firma_electronica configurada. Se marcan .skip en CI hasta que
 * el seed de qa-users incluya rol MC/ANES con PIN registrado.
 *
 * @QA automatizar full flow:
 *   - Login como qa.triagist@his.test (rol MC) → crear checklist → completar ítems → firmar.
 *   - Verificar que firma bloquea updates subsecuentes (CONFLICT).
 *   - Verificar que riesgoAnestesicoAsa fuera de [1-5] no se envía.
 *   - Login como qa.admin@his.test → verificar visibilidad (rol DIR).
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const ROUTE_LIST = "/ece/quirofano/preop";
const ROUTE_NUEVA = "/ece/quirofano/preop/nueva";

test.describe("ECE — Preoperatorio", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("PC-01: listado renderiza cabecera y filtro episodio hospitalario", async ({ page }) => {
    await page.goto(ROUTE_LIST);

    await expect(
      page.getByRole("heading", { name: /preoperatorio/i }),
    ).toBeVisible();

    await expect(page.getByLabel(/uuid del episodio hospitalario/i)).toBeVisible();

    await expect(
      page.getByRole("link", { name: /nuevo checklist/i }),
    ).toBeVisible();
  });

  test("PC-02: botón nuevo checklist navega al formulario", async ({ page }) => {
    await page.goto(ROUTE_LIST);

    await page.getByRole("link", { name: /nuevo checklist/i }).click();

    await expect(page).toHaveURL(ROUTE_NUEVA);
    await expect(
      page.getByRole("heading", { name: /nuevo checklist preoperatorio/i }),
    ).toBeVisible();
  });

  test("PC-03: formulario contiene ítems NTEC Art. 28", async ({ page }) => {
    await page.goto(ROUTE_NUEVA);

    // Campo episodio hospitalario
    await expect(page.getByLabel(/uuid del episodio hospitalario/i)).toBeVisible();

    // Campos numéricos
    await expect(page.getByLabel(/horas de ayuno/i)).toBeVisible();
    await expect(page.getByLabel(/riesgo anestésico asa/i)).toBeVisible();

    // Checkboxes obligatorios
    await expect(page.getByLabel(/identificación del paciente verificada/i)).toBeVisible();
    await expect(page.getByLabel(/sitio quirúrgico marcado/i)).toBeVisible();
    await expect(page.getByLabel(/consentimiento informado firmado/i)).toBeVisible();
    await expect(page.getByLabel(/marcapasos/i)).toBeVisible();
    await expect(page.getByLabel(/anticoagulantes/i)).toBeVisible();
    await expect(page.getByLabel(/retiro de prótesis/i)).toBeVisible();
  });

  test("PC-04: botón cancelar regresa al listado", async ({ page }) => {
    await page.goto(ROUTE_NUEVA);

    await page.getByRole("button", { name: /cancelar/i }).click();

    await expect(page).toHaveURL(ROUTE_LIST);
  });

  test.skip("PC-05: detalle renderiza sección de firma para checklist en borrador", async ({
    page,
  }) => {
    // Requiere seed: un preop_checklist en estado borrador.
    // UUID a reemplazar con el id real post-seed.
    const ID_BORRADOR = "00000000-0000-0000-0000-000000000000";

    await page.goto(`/ece/quirofano/preop/${ID_BORRADOR}`);

    await expect(
      page.getByRole("heading", { name: /checklist preoperatorio/i }),
    ).toBeVisible();

    // Sección de firma visible cuando estado = borrador
    await expect(page.getByLabel(/pin electrónico/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /firmar checklist/i })).toBeVisible();
  });
});
