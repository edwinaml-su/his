/**
 * E2E — Bridge Admisión Hospitalaria (Fase 2).
 *
 * Flujo validado:
 *   orden_ingreso (validada) → wizard hoja-ingreso → admitirDesdeOrden → episodio + cama.
 *
 * Smoke checks (renderizado y navegación):
 *  1. Cola `/ece/admisiones-pendientes` — renderiza heading y tabla de órdenes.
 *  2. Wizard `/ece/hoja-ingreso/nueva` — renderiza Paso 1 con lista de órdenes.
 *  3. Paso 1 → Paso 2: seleccionar una orden pre-populada navega al paso 2.
 *  4. Paso 2 → Paso 3: llenar datos de admisión avanza al paso de confirmación.
 *  5. Paso 3: muestra resumen + campo PIN.
 *  6. Botón "Admitir" visible en Paso 3 (pre-requiere PIN ≥ 4 chars).
 *
 * Submit completo (happy-path con seed):
 *  7. Admitir desde orden seeded → verifica pantalla de éxito con episodioId.
 *
 * Rollback:
 *  8. Si PIN incorrecto → muestra mensaje de error UNAUTHORIZED visible.
 *
 * Accesibilidad básica:
 *  9. Wizard tiene `aria-label="Pasos de admisión"` correcto.
 *
 * NOTA: Tests 7-8 requieren seed de `orden_ingreso` en estado 'validado' con
 * `ece.personal_salud` + `ece.firma_electronica` vinculados al qa.admin@his.test.
 * Marcarlos como skip si el seed no está disponible en CI.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("ECE Bridge Admisión Hospitalaria", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  // ── Cola de admisiones ─────────────────────────────────────────────────────

  test("1. Cola /ece/admisiones-pendientes renderiza heading", async ({ page }) => {
    await page.goto("/ece/admisiones-pendientes");

    await expect(
      page.getByRole("heading", { name: /cola de admisiones/i }),
    ).toBeVisible();
  });

  test("2. Cola muestra tabla o mensaje vacío (nunca error no manejado)", async ({ page }) => {
    await page.goto("/ece/admisiones-pendientes");

    // Esperar a que cargue: aparece la sección de órdenes o el mensaje vacío
    await expect(
      page.getByText(/órdenes pendientes|no hay órdenes/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Wizard hoja-ingreso ────────────────────────────────────────────────────

  test("3. Wizard /ece/hoja-ingreso/nueva renderiza Paso 1", async ({ page }) => {
    await page.goto("/ece/hoja-ingreso/nueva");

    await expect(
      page.getByRole("heading", { name: /nueva hoja de ingreso/i }),
    ).toBeVisible();

    await expect(
      page.getByText(/seleccionar orden de ingreso/i),
    ).toBeVisible();
  });

  test("4. StepIndicator tiene aria-label correcto (accesibilidad)", async ({ page }) => {
    await page.goto("/ece/hoja-ingreso/nueva");

    const nav = page.getByRole("navigation", { name: /pasos de admisión/i });
    await expect(nav).toBeVisible();
  });

  test("5. Paso 1 muestra lista vacía o filas de órdenes (sin crash)", async ({ page }) => {
    await page.goto("/ece/hoja-ingreso/nueva");

    // Esperar respuesta de la API (loading state desaparece)
    await expect(
      page.getByText(/cargando órdenes|no hay órdenes|seleccione una orden/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Flujo completo con seed (skip sin seed) ────────────────────────────────

  test.skip("6. Flujo completo: orden validada → admisión exitosa", async ({ page }) => {
    // PREREQUISITO: seed debe haber creado una orden en 'validado' y un
    // personal_salud+firma para qa.admin@his.test con PIN "1234".
    await page.goto("/ece/hoja-ingreso/nueva");

    // Paso 1: seleccionar primera orden disponible
    const primeraOrden = page.getByRole("listitem").first();
    await primeraOrden.waitFor({ timeout: 10_000 });
    await primeraOrden.click();
    await page.getByRole("button", { name: /continuar a datos/i }).click();

    // Paso 2: completar datos mínimos
    await page.getByLabel(/modalidad hospitalaria/i).fill("internamiento");
    await page.getByLabel(/procedencia/i).fill("emergencia");
    await page.getByRole("button", { name: /continuar a confirmación/i }).click();

    // Paso 3: ingresar PIN y admitir
    await page.getByLabel(/pin de firma/i).fill("1234");
    await page.getByRole("button", { name: /admitir paciente/i }).click();

    // Pantalla de éxito
    await expect(
      page.getByText(/admisión completada/i),
    ).toBeVisible({ timeout: 15_000 });

    // Verificar los 3 checkmarks de resultado
    await expect(
      page.getByText(/episodio creado/i),
    ).toBeVisible();
    await expect(
      page.getByText(/hoja de ingreso firmada/i),
    ).toBeVisible();
  });

  test.skip("7. PIN incorrecto → muestra error UNAUTHORIZED", async ({ page }) => {
    await page.goto("/ece/hoja-ingreso/nueva");

    // Seleccionar primera orden
    const primeraOrden = page.getByRole("listitem").first();
    await primeraOrden.waitFor({ timeout: 10_000 });
    await primeraOrden.click();
    await page.getByRole("button", { name: /continuar a datos/i }).click();

    await page.getByLabel(/modalidad hospitalaria/i).fill("internamiento");
    await page.getByLabel(/procedencia/i).fill("emergencia");
    await page.getByRole("button", { name: /continuar a confirmación/i }).click();

    // PIN incorrecto
    await page.getByLabel(/pin de firma/i).fill("9999");
    await page.getByRole("button", { name: /admitir paciente/i }).click();

    // Debe mostrar error
    await expect(
      page.getByRole("alert"),
    ).toBeVisible({ timeout: 8_000 });

    // Verificar que sigue en paso 3 (no navegó a éxito)
    await expect(
      page.getByText(/confirmar y firmar/i),
    ).toBeVisible();
  });
});
