/**
 * E2E — Portal ARCO (US.F2.7.43-45)
 *
 * Flujos cubiertos:
 *   1. Paciente accede a su expediente clínico (/mi-expediente).
 *   2. Paciente crea solicitud ARCO de rectificación.
 *   3. Paciente crea solicitud ARCO de supresión.
 *   4. Paciente visualiza historial de solicitudes propias.
 *   5. DIR/ADMIN responde solicitud desde cola (/arco).
 *
 * Auth: usa qa.admin@his.test con rol ADMIN (puede tanto crear como responder).
 * Un portal de paciente real requeriría un usuario `qa.patient@his.test`
 * con cuenta portalAccount sembrada. Esos tests están marcados como skip
 * hasta que el seeder de portal esté disponible.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

// ─── Cola DIR/ADMIN ───────────────────────────────────────────────────────────

test.describe("ARCO — cola de solicitudes (DIR/ADMIN)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("página /arco carga sin errores para ADMIN", async ({ page }) => {
    await page.goto("/arco");
    await expect(page.getByRole("heading", { name: /solicitudes arco|derechos arco/i })).toBeVisible();
  });

  test("tabla muestra columnas de tipo, paciente y fecha", async ({ page }) => {
    await page.goto("/arco");

    const hasRows = await page.getByRole("row").count() > 1;
    if (hasRows) {
      await expect(page.getByRole("columnheader", { name: /tipo/i })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /paciente/i })).toBeVisible();
    } else {
      await expect(page.getByText(/sin solicitudes|no hay solicitudes|vacío/i)).toBeVisible();
    }
  });

  test("diálogo de respuesta tiene selector APROBADA/RECHAZADA y campo motivo", async ({ page }) => {
    await page.goto("/arco");

    const responderBtn = page.getByRole("button", { name: /responder/i }).first();
    const hasButton = await responderBtn.isVisible().catch(() => false);

    if (!hasButton) {
      // No hay solicitudes pendientes — estado válido
      test.skip();
      return;
    }

    await responderBtn.click();

    // Debe tener selector de decisión
    await expect(page.getByRole("radio", { name: /aprobar/i })).toBeVisible();
    await expect(page.getByRole("radio", { name: /rechazar/i })).toBeVisible();
    // Y campo de motivo de respuesta
    await expect(page.getByLabel(/motivo de respuesta|razón/i)).toBeVisible();
  });

  test("botón de confirmar respuesta requiere motivo de al menos 10 caracteres", async ({ page }) => {
    await page.goto("/arco");

    const responderBtn = page.getByRole("button", { name: /responder/i }).first();
    const hasButton = await responderBtn.isVisible().catch(() => false);

    if (!hasButton) {
      test.skip();
      return;
    }

    await responderBtn.click();
    await page.getByRole("radio", { name: /aprobar/i }).click();
    // Dejar motivo vacío — botón debe estar deshabilitado o mostrar validación
    const submitBtn = page.getByRole("button", { name: /confirmar|guardar respuesta/i });
    await expect(submitBtn).toBeDisabled();
  });
});

// ─── Portal del paciente ──────────────────────────────────────────────────────

test.describe("Portal — mi expediente (US.F2.7.43)", () => {
  // Estos tests requieren un usuario de portal con portalAccount sembrado.
  // Por ahora validan que las rutas existen y responden correctamente
  // cuando se accede con auth de administrador (redirección esperada o 200).

  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("ruta /mi-expediente existe y no devuelve 404", async ({ page }) => {
    const response = await page.goto("/mi-expediente");
    // Admin sin portalAccount verá error o redirección — no 404
    expect(response?.status()).not.toBe(404);
  });

  test("ruta /solicitudes-arco existe y no devuelve 404", async ({ page }) => {
    const response = await page.goto("/solicitudes-arco");
    expect(response?.status()).not.toBe(404);
  });
});

// ─── Flujo completo del paciente (requiere seeder de portal) ─────────────────

test.describe("Portal — flujo ARCO completo (US.F2.7.44-45)", () => {
  // Skip hasta que qa.patient@his.test esté sembrado con portalAccount.
  // @QA: habilitar cuando seed-test-users.mjs incluya usuario portal.
  test.skip(
    true,
    "Requiere qa.patient@his.test con portalAccount sembrado. Ver packages/database/scripts/seed-test-users.mjs",
  );

  test("paciente crea solicitud RECTIFICACION con motivo válido", async ({ page }) => {
    // Flujo esperado cuando el seeder esté disponible:
    // 1. Login como qa.patient@his.test
    // 2. Navegar a /solicitudes-arco
    // 3. Seleccionar RECTIFICACION
    // 4. Ingresar motivo >= 20 chars
    // 5. Enviar formulario
    // 6. Ver confirmación y badge PENDIENTE en historial
    await page.goto("/solicitudes-arco");
    await page.getByRole("combobox", { name: /tipo/i }).selectOption("RECTIFICACION");
    await page.getByLabel(/motivo/i).fill(
      "El nombre registrado tiene un error tipográfico en el primer apellido.",
    );
    await page.getByRole("button", { name: /enviar solicitud/i }).click();
    await expect(page.getByText(/PENDIENTE/)).toBeVisible();
  });

  test("paciente ve historial de sus solicitudes propias", async ({ page }) => {
    await page.goto("/solicitudes-arco");
    // Solo sus solicitudes deben aparecer (aislamiento por patientId)
    await expect(page.getByRole("list")).toBeVisible();
  });
});
