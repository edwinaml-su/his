/**
 * E2E — ECE Signos Vitales
 *
 * Cubre:
 *   1. Carga de la página de historial (`/ece/signos-vitales`).
 *   2. Navegación al formulario de captura rápida (`/ece/signos-vitales/nueva`).
 *   3. Captura de valores con alerta crítica visible (SpO2 < 88).
 *   4. Accesibilidad mínima: heading visible, controles con label.
 *
 * Nota: estos son smoke tests (page-load + elementos clave). La integración
 * con el router tRPC `eceSignosVitales` se cubre en Sprint posterior
 * cuando el seed de E2E incluya un encuentro ECE abierto.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("ECE — Signos Vitales", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("historial: página carga con encabezado y tabla", async ({ page }) => {
    await page.goto("/ece/signos-vitales");
    await expect(page).toHaveURL(/\/ece\/signos-vitales/);

    // Encabezado principal
    await expect(
      page.getByRole("heading", { name: /signos vitales/i }),
    ).toBeVisible();

    // Botón "Nuevo registro"
    await expect(
      page.getByRole("link", { name: /nuevo registro/i }),
    ).toBeVisible();

    // Tabla de historial (al menos una fila con datos o mensaje vacío)
    const table = page.getByRole("table", { name: /historial de signos vitales/i });
    await expect(table).toBeVisible();
  });

  test("historial: sidebar muestra enlace 'Signos Vitales' bajo sección ECE", async ({ page }) => {
    await page.goto("/ece/signos-vitales");

    // El sidebar tiene el enlace de navegación
    const sidebarLink = page.getByRole("link", { name: /signos vitales/i });
    await expect(sidebarLink).toBeVisible();
  });

  test("historial: alerta crítica visible cuando hay valores fuera de rango", async ({ page }) => {
    await page.goto("/ece/signos-vitales");

    // Los datos mock incluyen registros con SpO2=89 y TA=85 (críticos)
    // El banner de alerta crítica debe estar presente
    const alertBanner = page.getByRole("status").filter({ hasText: /alerta crítica/i });
    await expect(alertBanner).toBeVisible();
  });

  test("formulario: carga con todos los controles de captura", async ({ page }) => {
    await page.goto("/ece/signos-vitales/nueva");
    await expect(page).toHaveURL(/\/ece\/signos-vitales\/nueva/);

    // Encabezado
    await expect(
      page.getByRole("heading", { name: /nuevo registro de signos vitales/i }),
    ).toBeVisible();

    // Campos numéricos (por label)
    await expect(page.getByLabel(/ta sistólica/i)).toBeVisible();
    await expect(page.getByLabel(/ta diastólica/i)).toBeVisible();
    await expect(page.getByLabel(/frecuencia cardíaca/i)).toBeVisible();
    await expect(page.getByLabel(/frecuencia respiratoria/i)).toBeVisible();
    await expect(page.getByLabel(/temperatura/i)).toBeVisible();
    await expect(page.getByLabel(/spo/i)).toBeVisible();

    // Slider de dolor
    await expect(page.getByLabel(/escala de dolor/i)).toBeVisible();

    // Botón de acción principal
    await expect(
      page.getByRole("button", { name: /registrar y firmar/i }),
    ).toBeVisible();
  });

  test("formulario: alerta crítica aparece al ingresar SpO2 < 88", async ({ page }) => {
    await page.goto("/ece/signos-vitales/nueva");

    // Ingresar SpO2 crítico (< 88 = criticalLow según VITAL_THRESHOLDS_ADULT)
    const spo2Input = page.getByLabel(/spo/i);
    await spo2Input.fill("85");
    await spo2Input.blur();

    // El banner de alerta crítica debe aparecer
    const alertBanner = page.getByTestId("alerta-critica");
    await expect(alertBanner).toBeVisible();
    await expect(alertBanner).toContainText(/spo2/i);
  });

  test("formulario: mensaje de error inline si valor fuera de rango", async ({ page }) => {
    await page.goto("/ece/signos-vitales/nueva");

    // TA sistólica fuera de rango aceptado (> 250)
    const sysInput = page.getByLabel(/ta sistólica/i);
    await sysInput.fill("999");
    await sysInput.blur();

    // Mensaje de error inline visible
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(/fuera del rango/i);
  });
});
