/**
 * E2E: Sustitución genérico-comercial autorizada (US.F2.6.11)
 *
 * Escenario cubierto:
 *   1. Farmacéutico accede a farmacia y ve el botón "Solicitar Sustitución".
 *   2. Propone sustitución con GTIN sustituto válido → modal confirma estado PENDIENTE.
 *   3. Médico navega a /medico/substitutions-pending y ve la solicitud.
 *   4. Médico autoriza con motivo → estado cambia a AUTORIZADA.
 *   5. Farmacéutico recarga y observa estado AUTORIZADA.
 *
 * Nota: Estos tests requieren BD de prueba con datos sembrados
 * (catálogo ece.gs1_gtin_sustitucion con el par de GTIN).
 * Marcados como skip por defecto — habilitar cuando CI tenga BD E2E con GS1 seed.
 *
 * @QA: Automatizar con datos seed GS1 en packages/database/scripts/seed-test-users.mjs.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

// GTIN de prueba — deben existir en ece.gs1_gtin + ece.gs1_gtin_sustitucion en BD de test.
const GTIN_ORIGINAL  = "07501000001230"; // 14 dígitos con check digit válido (placeholder)
const GTIN_SUSTITUTO = "07501000005674";

test.describe("Sustitución genérico-comercial", () => {
  test.skip(
    true,
    "Requiere BD de prueba con catálogo GS1 sembrado (ver @QA para setup).",
  );

  test("farmacéutico propone sustitución y médico autoriza", async ({ page, context }) => {
    // ── Paso 1: Farmacéutico abre la página de despacho ──────────────────
    await login(page, "admin"); // admin tiene rol PHARM en seed
    await page.goto("/pharmacy/dispense");
    await expect(page.getByRole("heading", { name: /despachar/i })).toBeVisible();

    // ── Paso 2: Propone sustitución ────────────────────────────────────────
    // El botón "Solicitar Sustitución" aparece cuando hay ítems sin stock
    // (requiere receta SIGNED con ítem GTIN_ORIGINAL en BD de test)
    const solicitarBtn = page.getByRole("button", { name: /solicitar sustitución/i }).first();
    await solicitarBtn.click();

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    await modal.getByLabel(/gtin sustituto/i).fill(GTIN_SUSTITUTO);
    await modal.getByRole("button", { name: /solicitar sustitución/i }).click();

    // Espera confirmación de estado PENDIENTE
    await expect(modal.getByText(/pendiente de autorización/i)).toBeVisible({ timeout: 10_000 });

    // ── Paso 3: Médico abre otra pestaña y autoriza ────────────────────────
    const medicoPage = await context.newPage();
    await login(medicoPage, "physician");
    await medicoPage.goto("/medico/substitutions-pending");

    await expect(medicoPage.getByRole("heading", { name: /sustituciones pendientes/i })).toBeVisible();
    await expect(medicoPage.getByText(GTIN_ORIGINAL)).toBeVisible({ timeout: 10_000 });

    await medicoPage.getByRole("button", { name: /autorizar/i }).first().click();

    const decisionModal = medicoPage.getByRole("dialog");
    await expect(decisionModal).toBeVisible();
    await decisionModal.getByLabel(/motivo/i).fill("Equivalente terapéutico validado — misma molécula.");
    await decisionModal.getByRole("button", { name: /^autorizar$/i }).click();

    await expect(medicoPage.getByText(/no hay sustituciones/i)).toBeVisible({ timeout: 10_000 });
    await medicoPage.close();

    // ── Paso 4: Farmacéutico actualiza y ve estado AUTORIZADA ─────────────
    await page.getByRole("button", { name: /actualizar/i }).click();
    await expect(modal.getByText(/autorizada/i)).toBeVisible({ timeout: 10_000 });
  });

  test("propuesta con GTIN sin equivalencia es bloqueada", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/pharmacy/dispense");

    const solicitarBtn = page.getByRole("button", { name: /solicitar sustitución/i }).first();
    await solicitarBtn.click();

    const modal = page.getByRole("dialog");
    await modal.getByLabel(/gtin sustituto/i).fill("99991000000000");
    await modal.getByRole("button", { name: /solicitar sustitución/i }).click();

    await expect(modal.getByText(/sin_equivalencia_autorizada/i)).toBeVisible({ timeout: 8_000 });
  });
});
