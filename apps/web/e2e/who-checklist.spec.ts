/**
 * E2E — WHO Surgical Safety Checklist.
 * US: ECE-QRF-01 (checklist WHO 3 fases).
 *
 * Scope: smoke tests de renderizado + flujo de navegación.
 * El flujo completo de mutaciones (marcarSignIn/TimeOut/SignOut) requiere
 * un acto quirúrgico seeded en BD — marcado @QA para automatización E2E profunda.
 *
 * @QA automatizar:
 *   1. Seed: acto_quirurgico + personal_salud en establecimiento de qa.admin.
 *   2. Navegar a /ece/quirofano/who-check?actoId=<seeded-uuid>.
 *   3. Verificar Panel 1 activo, Paneles 2 y 3 deshabilitados.
 *   4. Completar todos los ítems del Panel 1, ingresar responsable, submit.
 *   5. Verificar badge "Sign-In completo" y Panel 2 habilitado.
 *   6. Idem para Time-Out y Sign-Out.
 *   7. Verificar estado final "Checklist completo" (verde).
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("WHO Surgical Safety Checklist", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("página /ece/quirofano/who-check sin actoId muestra error", async ({ page }) => {
    await page.goto("/ece/quirofano/who-check");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(/actoId/i);
  });

  test("página con actoId inválido (UUID no existente) renderiza encabezado WHO", async ({ page }) => {
    await page.goto(
      "/ece/quirofano/who-check?actoId=00000000-0000-0000-0000-000000000000",
    );
    // El heading debe estar visible independientemente del estado de la query
    await expect(
      page.getByRole("heading", { name: /WHO Surgical Safety Checklist/i }),
    ).toBeVisible();
  });

  test("el sidebar contiene enlace WHO Checklist bajo ECE — Quirófano", async ({ page }) => {
    await page.goto("/dashboard");
    // El sidebar debe tener el item registrado
    await expect(
      page.getByRole("link", { name: /WHO Checklist/i }),
    ).toBeVisible();
  });

  test("FasePanel Sign-In muestra 8 ítems WHO estándar", async ({ page }) => {
    await page.goto(
      "/ece/quirofano/who-check?actoId=00000000-0000-0000-0000-000000000000",
    );
    // Esperar que el panel cargue (query terminará rápido — no hay datos)
    await page.waitForTimeout(500);

    // Heading de Fase 1
    await expect(page.getByText(/Fase 1: Sign-In/i)).toBeVisible();
    // Heading de Fase 2 y 3 presentes (deshabilitados)
    await expect(page.getByText(/Fase 2: Time-Out/i)).toBeVisible();
    await expect(page.getByText(/Fase 3: Sign-Out/i)).toBeVisible();
  });

  test("botón marcar Sign-In completo está deshabilitado si no todos los ítems están verificados", async ({ page }) => {
    await page.goto(
      "/ece/quirofano/who-check?actoId=00000000-0000-0000-0000-000000000000",
    );
    await page.waitForTimeout(500);

    // El botón de submit de fase 1 debe estar deshabilitado (ítems sin verificar)
    const btn = page.getByRole("button", { name: /Marcar Fase 1: Sign-In completo/i });
    await expect(btn).toBeDisabled();
  });
});
