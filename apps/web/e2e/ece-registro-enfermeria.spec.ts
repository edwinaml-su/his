/**
 * E2E — ECE Registro de Enfermería.
 *
 * Cubre:
 *   1. Agenda del turno: navega a /ece/registro-enfermeria y verifica
 *      la estructura de la página (heading, selector de turno, tabla/mensaje).
 *   2. Abrir registro (cabecera): navega a /ece/registro-enfermeria/nuevo,
 *      verifica el formulario de cabecera y la validación client-side.
 *   3. Vista MAR: navega a /ece/registro-enfermeria/<stub-id> y verifica
 *      que el modal BCMA abre correctamente.
 *   4. Modal BCMA: valida que los 5 campos BCMA están presentes y que el
 *      botón "Confirmar" permanece deshabilitado hasta completar los 3 scans.
 *
 * Limitaciones (anotadas):
 *   - Los datos en BD de test son mínimos; la tabla de pacientes puede
 *     aparecer vacía. Los tests verifican estructura, no filas específicas.
 *   - La creación real de instancia workflow requiere tipoDocumentoId
 *     sembrado en ECE; ese seed no existe aún — el test valida hasta la
 *     capa de validación client-side.
 *
 * SKIP_E2E_ECE=1 omite toda la suite.
 */

import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const SKIP = process.env.SKIP_E2E_ECE === "1";

// UUID stub (no existe en BD — el servidor devolverá NOT_FOUND, aceptable para smoke).
const STUB_ADMISSION_ID = "00000000-0000-0000-0000-000000000099";

test.describe("ECE — Registro de Enfermería", () => {
  test.skip(SKIP, "SKIP_E2E_ECE=1 — omitido por env");

  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  // ─── Escenario 1: Agenda del turno ──────────────────────────────────────────

  test("1. Agenda del turno renderiza heading y selector de turno", async ({
    page,
  }) => {
    await page.goto("/ece/registro-enfermeria");
    await expect(page).toHaveURL(/ece\/registro-enfermeria/);

    await expect(
      page.getByRole("heading", { name: /registro de enfermería/i }),
    ).toBeVisible();

    // Selector de turno presente
    await expect(page.getByLabel(/turno activo/i)).toBeVisible();

    // Botón "Abrir registro" enlaza a /nuevo
    await expect(
      page.getByRole("link", { name: /abrir registro/i }),
    ).toBeVisible();

    // Tabla de pacientes o mensaje vacío — ambos aceptables
    const hasTable = (await page.getByRole("table").count()) > 0;
    const hasEmpty = (await page.getByText(/sin pacientes internados/i).count()) > 0;

    test.info().annotations.push({
      type: "agenda-state",
      description: hasTable ? "Tabla con pacientes" : "Sin pacientes (BD vacía en test)",
    });

    expect(hasTable || hasEmpty).toBe(true);
  });

  // ─── Escenario 2: Abrir registro — cabecera ─────────────────────────────────

  test("2. Formulario de abrir registro valida UUID vacío", async ({ page }) => {
    await page.goto("/ece/registro-enfermeria/nuevo");
    await expect(page).toHaveURL(/ece\/registro-enfermeria\/nuevo/);

    await expect(
      page.getByRole("heading", { name: /abrir registro de enfermería/i }),
    ).toBeVisible();

    // Campos requeridos presentes
    await expect(page.getByLabel(/uuid del paciente/i)).toBeVisible();
    await expect(page.getByLabel(/turno/i)).toBeVisible();
    await expect(page.getByLabel(/observaciones/i)).toBeVisible();

    // Intentar enviar con pacienteId vacío → error client-side
    await page.getByRole("button", { name: /abrir registro/i }).click();

    await expect(
      page.getByRole("alert").or(page.getByText(/uuid del paciente es requerido/i)).first(),
    ).toBeVisible();

    // El formulario no redirige
    await expect(page).toHaveURL(/ece\/registro-enfermeria\/nuevo/);
  });

  test("2b. Formulario rechaza UUID con formato inválido", async ({ page }) => {
    await page.goto("/ece/registro-enfermeria/nuevo");
    await page.getByLabel(/uuid del paciente/i).fill("no-es-uuid");
    await page.getByRole("button", { name: /abrir registro/i }).click();

    await expect(
      page.getByRole("alert").or(page.getByText(/formato válido/i)).first(),
    ).toBeVisible();
  });

  // ─── Escenario 3: Vista MAR ─────────────────────────────────────────────────

  test("3. Vista MAR renderiza secciones clave", async ({ page }) => {
    await page.goto(`/ece/registro-enfermeria/${STUB_ADMISSION_ID}`);

    await expect(
      page.getByRole("heading", { name: /mar — registro de administración/i }),
    ).toBeVisible();

    // Secciones principales
    await expect(page.getByText(/indicaciones pendientes/i)).toBeVisible();
    await expect(page.getByText(/historial de administraciones/i)).toBeVisible();

    // Botón de acción disponible
    const adminBtn = page
      .getByRole("button", { name: /administrar/i })
      .first();
    await expect(adminBtn).toBeVisible();
  });

  // ─── Escenario 4: Modal BCMA ────────────────────────────────────────────────

  test("4. Modal BCMA abre con los 5 campos y botón deshabilitado sin scans", async ({
    page,
  }) => {
    await page.goto(`/ece/registro-enfermeria/${STUB_ADMISSION_ID}`);

    // Abrir modal BCMA
    await page.getByRole("button", { name: /administrar/i }).first().click();

    const modal = page.getByRole("dialog", {
      name: /administrar medicamento.*bcma/i,
    });
    await expect(modal).toBeVisible();

    // Los 5 correctos representados: heading + labels
    await expect(modal.getByText(/verificación bcma/i)).toBeVisible();
    await expect(modal.getByText(/1\. paciente/i)).toBeVisible();
    await expect(modal.getByText(/2\. medicamento/i)).toBeVisible();
    await expect(modal.getByText(/3\. proveedor/i)).toBeVisible();
    await expect(modal.getByLabel(/dosis administrada/i)).toBeVisible();
    await expect(modal.getByLabel(/vía/i)).toBeVisible();

    // Sin scans: botón Confirmar deshabilitado (BCMA incompleto)
    const confirmBtn = modal.getByRole("button", {
      name: /confirmar administración/i,
    });
    await expect(confirmBtn).toBeDisabled();

    test.info().annotations.push({
      type: "bcma-gate",
      description:
        "Botón Confirmar deshabilitado correctamente hasta completar 3 scans BCMA.",
    });

    // Verificar los 3 scans habilita el botón
    await modal.getByRole("button", { name: /verificar/i, exact: true }).nth(0).click();
    await modal.getByRole("button", { name: /verificar/i, exact: true }).nth(0).click();
    await modal.getByRole("button", { name: /verificar/i, exact: true }).nth(0).click();

    // Con los 3 scans activos el botón debe habilitarse
    await expect(confirmBtn).toBeEnabled({ timeout: 3_000 });

    // Cerrar sin confirmar
    await modal.getByRole("button", { name: /cancelar/i }).click();
    await expect(modal).not.toBeVisible();
  });
});
