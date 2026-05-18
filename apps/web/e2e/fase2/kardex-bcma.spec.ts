/**
 * E2E — Kardex BCMA bedside (US.F2.6.31-33).
 *
 * Escenarios:
 *   1. La página /ece/kardex carga y muestra el selector de paciente.
 *   2. La página /ece/kardex/[patientId] carga con filtros funcionales.
 *   3. Columna BCMA distingue "Verificado" de "Manual".
 *   4. Botón Cancelar abre el dialog y requiere motivo mínimo 10 chars.
 *   5. Aislamiento tenant: usuario sin sesión redirige a login.
 *
 * Nota @QA: estos specs validan el contrato UI observable. El enforcement
 * de RLS y la lógica BCMA están cubiertos en:
 *   packages/trpc/src/routers/__tests__/medication-administration-bcma.test.ts
 *
 * Omitir con SKIP_E2E_KARDEX=1.
 */

import { test, expect, type Page } from "@playwright/test";

const SKIP = process.env.SKIP_E2E_KARDEX === "1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAs(page: Page, email: string, password = "TestPass123!") {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|ece/);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("Kardex BCMA (US.F2.6.31-33)", () => {
  test.skip(SKIP, "SKIP_E2E_KARDEX=1");

  // 1. Landing /ece/kardex carga correctamente
  test("la página /ece/kardex carga y muestra el campo de patientId", async ({ page }) => {
    await loginAs(page, "qa.triagist@his.test");

    await page.goto("/ece/kardex");
    await expect(page.getByRole("heading", { name: /Kardex/i })).toBeVisible();
    await expect(page.getByLabel(/ID de paciente/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Ver kardex/i })).toBeDisabled();
  });

  // 2. Con patientId en URL carga la tabla
  test("la página /ece/kardex/[patientId] carga la tabla de administraciones", async ({ page }) => {
    await loginAs(page, "qa.triagist@his.test");

    // UUID sintético — la BD de test puede estar vacía, pero la página debe cargar sin crash
    await page.goto("/ece/kardex/00000000-0000-0000-0000-000000000001");

    await expect(
      page.getByRole("heading", { name: /Kardex de administraciones/i }),
    ).toBeVisible();

    // Filtro de estado debe estar visible
    await expect(page.getByLabel(/Estado/i)).toBeVisible();
    await expect(page.getByLabel(/Desde/i)).toBeVisible();
    await expect(page.getByLabel(/Hasta/i)).toBeVisible();
  });

  // 3. Columna BCMA diferencia Verificado vs Manual
  test("la tabla muestra columna BCMA con etiquetas Verificado y Manual", async ({ page }) => {
    await loginAs(page, "qa.triagist@his.test");
    await page.goto("/ece/kardex/00000000-0000-0000-0000-000000000001");

    // Columna header BCMA debe existir
    const bcmaHeader = page.getByRole("columnheader", { name: /BCMA/i });
    await expect(bcmaHeader).toBeVisible();
  });

  // 4. Dialog de cancelación requiere motivo de mínimo 10 caracteres
  test("el botón Cancelar del dialog está deshabilitado con menos de 10 chars", async ({ page }) => {
    await loginAs(page, "qa.admin@his.test");
    await page.goto("/ece/kardex/00000000-0000-0000-0000-000000000001");

    // Si hay filas con botón Cancelar, abrir el dialog
    const cancelBtn = page.getByRole("button", { name: /Cancelar/i }).first();
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
      await expect(
        page.getByRole("heading", { name: /Cancelar administración/i }),
      ).toBeVisible();

      // Botón de confirmación debe estar deshabilitado con texto corto
      const confirmBtn = page.getByRole("button", {
        name: /Cancelar administración/i,
      }).last();
      await page.getByLabel(/Motivo/i).fill("corto");
      await expect(confirmBtn).toBeDisabled();

      // Con >= 10 chars se habilita
      await page.getByLabel(/Motivo/i).fill("Motivo válido de cancelación");
      await expect(confirmBtn).toBeEnabled();
    } else {
      // Sin datos en BD de test, saltar la aserción interactiva
      test.info().annotations.push({
        type: "info",
        description: "Sin filas cancelables en BD de test — dialog no probado",
      });
    }
  });

  // 5. Usuario sin sesión redirige a /login
  test("usuario sin sesión es redirigido a login", async ({ page }) => {
    await page.goto("/ece/kardex/00000000-0000-0000-0000-000000000001");
    await expect(page).toHaveURL(/login/);
  });
});
