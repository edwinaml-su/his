/**
 * E2E: Sustitución genérico-comercial autorizada (US.F2.6.11)
 *
 * Escenario cubierto:
 *   1. Farmacéutico entra a la cola de picking (/pharmacy/dispense), inicia
 *      la dispensación de una orden y llega a /pharmacy/dispense/[orderId].
 *   2. Llena GTIN + ID de ítem de receta y hace clic en "Solicitar Sustitución"
 *      → se abre el modal (SubstitutionModal) montado en esa página.
 *   3. Propone sustitución con GTIN sustituto válido → modal confirma estado
 *      PENDIENTE y la página muestra el banner de despacho bloqueado con
 *      "Validar y reservar" deshabilitado.
 *   4. Médico navega a /medico/substitutions-pending y ve la solicitud.
 *   5. Médico autoriza con motivo → estado cambia a AUTORIZADA.
 *   6. Farmacéutico ve el bloqueo levantado (poll 15 s) y "Validar y reservar"
 *      vuelve a habilitarse.
 *
 * Nota: Estos tests requieren BD de prueba con datos sembrados
 * (catálogo ece.gs1_gtin_sustitucion con el par de GTIN, más una receta
 * SIGNED con el ítem PRESCRIPTION_ITEM_ID en la cola de picking).
 * Marcados como skip por defecto — habilitar cuando CI tenga BD E2E con GS1 seed.
 *
 * @QA: Automatizar con datos seed GS1 en packages/database/scripts/seed-test-users.mjs.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

// GTIN de prueba — deben existir en ece.gs1_gtin + ece.gs1_gtin_sustitucion en BD de test.
const GTIN_ORIGINAL  = "07501000001230"; // 14 dígitos con check digit válido (placeholder)
const GTIN_SUSTITUTO = "07501000005674";
// Debe corresponder a un PrescriptionItem real de la primera orden en la cola.
const PRESCRIPTION_ITEM_ID = "00000000-0000-0000-0000-000000000001";

test.describe("Sustitución genérico-comercial", () => {
  test.skip(
    true,
    "Requiere BD de prueba con catálogo GS1 sembrado (ver @QA para setup).",
  );

  test("farmacéutico propone sustitución y médico autoriza", async ({ page, context }) => {
    // ── Paso 1: Farmacéutico entra a la cola y abre una orden ────────────
    await login(page, "admin"); // admin tiene rol PHARM en seed
    await page.goto("/pharmacy/dispense");
    await expect(
      page.getByRole("heading", { name: "Estación de Picking — Cola de Dispensación" }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^iniciar dispensación/i }).first().click();
    await expect(page).toHaveURL(/\/pharmacy\/dispense\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Dispensación GS1" })).toBeVisible();

    // ── Paso 2: Llena GTIN sin stock + ítem, solicita sustitución ─────────
    await page.getByLabel("GTIN-14 *").fill(GTIN_ORIGINAL);
    await page.getByLabel("ID Ítem de Receta *").fill(PRESCRIPTION_ITEM_ID);

    const solicitarBtn = page.getByRole("button", { name: "Solicitar Sustitución" });
    await solicitarBtn.click();

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    await modal.getByLabel(/gtin sustituto/i).fill(GTIN_SUSTITUTO);
    await modal.getByRole("button", { name: "Solicitar sustitución" }).click();

    // Espera confirmación de estado PENDIENTE
    await expect(modal.getByText(/pendiente de autorización/i)).toBeVisible({ timeout: 10_000 });
    await modal.getByRole("button", { name: "Cerrar" }).click();

    // ── Paso 3: El despacho queda bloqueado en la página ──────────────────
    await expect(
      page.getByText(/despacho bloqueado — sustitución pendiente de autorización médica/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Validar y reservar" })).toBeDisabled();

    // ── Paso 4: Médico abre otra pestaña y autoriza ────────────────────────
    const medicoPage = await context.newPage();
    await login(medicoPage, "physician");
    await medicoPage.goto("/medico/substitutions-pending");

    await expect(medicoPage.getByRole("heading", { name: "Sustituciones pendientes" })).toBeVisible();
    await expect(medicoPage.getByText(GTIN_ORIGINAL)).toBeVisible({ timeout: 10_000 });

    await medicoPage.getByRole("button", { name: "Autorizar" }).first().click();

    const decisionModal = medicoPage.getByRole("dialog");
    await expect(decisionModal).toBeVisible();
    await decisionModal.getByLabel(/motivo/i).fill("Equivalente terapéutico validado — misma molécula.");
    await decisionModal.getByRole("button", { name: "Autorizar" }).click();

    await expect(
      medicoPage.getByText("No hay sustituciones pendientes de su autorización."),
    ).toBeVisible({ timeout: 10_000 });
    await medicoPage.close();

    // ── Paso 5: Farmacéutico ve el bloqueo levantado (poll 15 s) ──────────
    await expect(
      page.getByText(/despacho bloqueado — sustitución pendiente de autorización médica/i),
    ).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Validar y reservar" })).toBeEnabled();
  });

  test("propuesta con GTIN sin equivalencia es bloqueada", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/pharmacy/dispense");
    await page.getByRole("button", { name: /^iniciar dispensación/i }).first().click();
    await expect(page).toHaveURL(/\/pharmacy\/dispense\/[^/]+$/);

    await page.getByLabel("GTIN-14 *").fill(GTIN_ORIGINAL);
    await page.getByLabel("ID Ítem de Receta *").fill(PRESCRIPTION_ITEM_ID);
    await page.getByRole("button", { name: "Solicitar Sustitución" }).click();

    const modal = page.getByRole("dialog");
    await modal.getByLabel(/gtin sustituto/i).fill("99991000000000");
    await modal.getByRole("button", { name: "Solicitar sustitución" }).click();

    await expect(modal.getByText(/sin_equivalencia_autorizada/i)).toBeVisible({ timeout: 8_000 });
  });
});
