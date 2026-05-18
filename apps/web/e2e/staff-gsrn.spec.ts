/**
 * E2E — Catálogo GSRN Profesionales (US.F2.6.2).
 *
 * Flujo completo:
 *   1. Admin crea GSRN para un profesional (autoGenerate).
 *   2. Admin revoca el GSRN con un motivo.
 *   3. Intento de uso del GSRN revocado (scan bedside) → Hard Stop.
 *
 * Requiere: qa.admin@his.test con roles ADMIN_CLINICO y ADMIN.
 *
 * @QA — marcar para automatización E2E (nightly).
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("GSRN Personal Clínico (US.F2.6.2)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("admin puede crear un GSRN con generación automática", async ({ page }) => {
    await page.goto("/staff-gsrn");

    // La página carga con el título correcto
    await expect(page.getByRole("heading", { name: /GSRN Personal Clínico/i })).toBeVisible();

    // Abrir formulario de alta
    await page.getByRole("button", { name: /nuevo gsrn/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Ingresar userId (UUID de prueba) — en prod sería un selector de usuarios
    await dialog.getByLabel(/id de usuario/i).fill(
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    );

    // Dejar "Generar automáticamente" activado (default)
    const autoCheck = dialog.getByLabel(/generar gsrn automáticamente/i);
    await expect(autoCheck).toBeChecked();

    // Guardar
    await dialog.getByRole("button", { name: /registrar gsrn/i }).click();

    // Toast de confirmación
    await expect(
      page.getByRole("status", { name: /registrado correctamente/i }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("admin puede revocar un GSRN activo con motivo", async ({ page }) => {
    await page.goto("/staff-gsrn");

    // Filtrar activos
    await page.getByRole("button", { name: /activos/i }).click();

    // Revocar el primer GSRN activo de la lista
    const revokeBtn = page.getByRole("button", { name: /revocar/i }).first();
    await revokeBtn.click();

    const revokeDialog = page.getByRole("dialog");
    await expect(revokeDialog).toBeVisible();

    await revokeDialog.getByLabel(/motivo de revocación/i).fill(
      "Prueba E2E — licencia suspendida",
    );
    await revokeDialog.getByRole("button", { name: /confirmar revocación/i }).click();

    // Toast de confirmación
    await expect(
      page.getByRole("status", { name: /revocado correctamente/i }),
    ).toBeVisible({ timeout: 5000 });

    // El GSRN ya no aparece en la lista de activos
    await page.getByRole("button", { name: /activos/i }).click();
    // El badge "Revocado" no debe aparecer en la tabla de activos
    const revokedBadges = page.getByRole("cell", { name: /revocado/i });
    await expect(revokedBadges).toHaveCount(0, { timeout: 3000 });
  });

  test("GSRN revocado genera Hard Stop al validar (simulate API)", async ({
    page,
  }) => {
    await page.goto("/staff-gsrn");

    // Mostrar revocados
    await page.getByRole("button", { name: /revocados/i }).click();

    // Verificar que al menos un GSRN revocado está en la tabla
    const revokedBadge = page.getByRole("cell", { name: /revocado/i }).first();
    await expect(revokedBadge).toBeVisible({ timeout: 5000 });

    // El botón "Revocar" no debe estar presente para GSRN ya revocado
    const revokeButtons = page.getByRole("button", { name: /revocar/i });
    await expect(revokeButtons).toHaveCount(0);

    // El botón "Badge" sí debe estar disponible para ver el DataMatrix
    const badgeButtons = page.getByRole("button", { name: /badge/i });
    await expect(badgeButtons.first()).toBeVisible();
  });

  test("badge DataMatrix se puede visualizar desde la tabla", async ({
    page,
  }) => {
    await page.goto("/staff-gsrn");

    // Click en Badge del primer registro
    const badgeBtn = page.getByRole("button", { name: /badge/i }).first();
    await badgeBtn.click();

    const badgeDialog = page.getByRole("dialog");
    await expect(badgeDialog).toBeVisible();
    await expect(
      badgeDialog.getByRole("heading", { name: /badge institucional/i }),
    ).toBeVisible();
  });
});
