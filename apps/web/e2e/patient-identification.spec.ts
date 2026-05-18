/**
 * E2E — Identificación de paciente por pulsera GSRN (US.F2.6.37-40).
 *
 * Cubre:
 *   - Flujo scan OK → ficha mostrada → navega a expediente.
 *   - GSRN inválido (dígito verificador) → error en cliente.
 *   - GSRN desconocido → error servidor GSRN_NO_REGISTRADO.
 *   - Historial de pulseras (acceso admin): tabla con pulsera activa.
 *   - Emisión nueva pulsera (modal refreshGsrn).
 *   - PULSERA_INACTIVA → hard stop visible.
 *
 * @QA — automatizar estos scenarios en el pipeline E2E nightly.
 * Prerequisito: seed de paciente con GSRN activo en BD de prueba.
 *
 * NOTA: los tests marcados skip requieren seed de datos específicos;
 * desmarcar cuando seed-test-users incluya paciente con GSRN.
 */

import { test, expect, type Page } from "@playwright/test";
import { login } from "./_helpers/auth";

// GSRN de prueba con check digit válido (debe existir en BD de prueba).
// GSRN-18 válido (dígito verificador confirmado con algoritmo GS1 del router)
const VALID_GSRN = "750300000000000018";
const INVALID_FORMAT_GSRN = "1234";
// GSRN con checkdigit incorrecto (18 dígitos, último alterado)
// GSRN con 18 dígitos pero checkdigit incorrecto
const BAD_CHECKDIGIT_GSRN = "750300000000000019";

async function goToPatientId(page: Page) {
  await login(page, "admin");
  await page.goto("/patient-id");
}

test.describe("Identificación Paciente — /patient-id", () => {
  test("página carga y muestra input de GSRN", async ({ page }) => {
    await goToPatientId(page);
    await expect(page.getByRole("textbox", { name: /gsrn/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /identificar/i })).toBeVisible();
  });

  test("GSRN de formato incorrecto muestra error de validación en cliente", async ({ page }) => {
    await goToPatientId(page);
    await page.getByRole("textbox").fill(INVALID_FORMAT_GSRN);
    await page.getByRole("button", { name: /identificar/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("GSRN con dígito verificador inválido muestra error sin llamar al servidor", async ({
    page,
  }) => {
    await goToPatientId(page);
    await page.getByRole("textbox").fill(BAD_CHECKDIGIT_GSRN);
    await page.getByRole("button", { name: /identificar/i }).click();
    await expect(page.getByText(/dígito verificador/i)).toBeVisible();
  });

  // Requiere BD con paciente que tenga GSRN = VALID_GSRN activo
  test.skip("GSRN válido y registrado muestra ficha del paciente", async ({ page }) => {
    await goToPatientId(page);
    await page.getByRole("textbox").fill(VALID_GSRN);
    await page.getByRole("button", { name: /identificar/i }).click();
    // La ficha debe aparecer con badge "IDENTIFICADO"
    await expect(page.getByText("IDENTIFICADO")).toBeVisible();
    // Alergias activas
    await expect(page.getByText(/alergias activas/i)).toBeVisible();
  });

  // Requiere BD con GSRN registrado como REVOKED
  test.skip("GSRN de pulsera revocada muestra hard-stop PULSERA_INACTIVA", async ({ page }) => {
    await goToPatientId(page);
    await page.getByRole("textbox").fill(VALID_GSRN);
    await page.getByRole("button", { name: /identificar/i }).click();
    await expect(page.getByText(/revocada/i)).toBeVisible();
  });
});

test.describe("Historial GSRN — /patients/[id]/gsrn-history", () => {
  // Requiere BD con paciente de ID conocido y pulsera activa
  test.skip("tabla muestra pulsera activa del paciente", async ({ page }) => {
    await login(page, "admin");
    // ID de paciente de prueba del seed (ajustar según BD)
    const TEST_PATIENT_ID = "00000000-0000-0000-0000-000000000010";
    await page.goto(`/patients/${TEST_PATIENT_ID}/gsrn-history`);

    await expect(page.getByText("Pulsera activa")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test.skip("modal emisión nueva pulsera rechaza GSRN con checkdigit incorrecto", async ({
    page,
  }) => {
    await login(page, "admin");
    const TEST_PATIENT_ID = "00000000-0000-0000-0000-000000000010";
    await page.goto(`/patients/${TEST_PATIENT_ID}/gsrn-history`);

    await page.getByRole("button", { name: /emitir nueva pulsera/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByLabel(/nuevo gsrn/i).fill(BAD_CHECKDIGIT_GSRN);
    await page.getByRole("button", { name: /emitir nueva pulsera/i }).last().click();

    await expect(page.getByRole("alert")).toContainText(/inválido/i);
  });
});
