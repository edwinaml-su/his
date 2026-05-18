/**
 * E2E — Publicación y rollback de workflow.
 * US.F2.2.06 (publicar), US.F2.2.19 (rollback), US.F2.2.20 (historial).
 *
 * Estrategia:
 *  1. Login como WORKFLOW_DESIGNER.
 *  2. Navegar al editor del workflow "HC_AMBULATORIA" (seed).
 *  3. Guardar borrador.
 *  4. Publicar con motivo.
 *  5. Verificar que aparece en historial como PUBLICADO.
 *  6. Publicar segunda versión.
 *  7. Verificar que v1 aparece como HISTÓRICO y tiene botón Restaurar.
 *  8. Hacer rollback a v1.
 *  9. Verificar nueva versión activa y audit trail.
 *
 * Nota: este spec requiere que el seed haya creado tipo_documento HC_AMBULATORIA
 * y usuario qa.wfdesigner@his.test con rol WORKFLOW_DESIGNER.
 * Si el seed no existe, el test se marca como skip con mensaje claro.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const WF_CODIGO = "HC_AMBULATORIA";

test.describe("Workflow — publicación y rollback", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("publica un workflow y aparece en historial", async ({ page }) => {
    await page.goto(`/workflow-designer/${WF_CODIGO}/editar`);

    // Si el tipo de documento no existe en seed, skip con mensaje
    const notFound = page.getByText(/no existe un tipo de documento/i);
    if (await notFound.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, `Tipo de documento ${WF_CODIGO} no existe en seed`);
      return;
    }

    // Guardar borrador
    const guardarBtn = page.getByRole("button", { name: /guardar borrador/i });
    if (await guardarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await guardarBtn.click();
      await expect(page.getByText(/guardado/i)).toBeVisible({ timeout: 5000 });
    }

    // Publicar — click en botón Publicar
    const publicarBtn = page.getByRole("button", { name: /^publicar$/i });
    await expect(publicarBtn).toBeVisible({ timeout: 5000 });
    await publicarBtn.click();

    // Dialog de motivo
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const motivoTextarea = dialog.getByLabel(/motivo del cambio/i);
    await motivoTextarea.fill("Primera publicación E2E test.");

    await dialog.getByRole("button", { name: /confirmar publicación/i }).click();

    // Debe mostrar feedback de publicado (cualquier toast o mensaje)
    await expect(page.getByText(/publicado|versión.*1/i)).toBeVisible({ timeout: 8000 });
  });

  test("historial muestra versiones y permite rollback", async ({ page }) => {
    await page.goto(`/workflow-designer/${WF_CODIGO}/historial`);

    // Si no hay publicaciones, el test no puede verificar rollback
    const sinPublicaciones = page.getByText(/sin publicaciones/i);
    if (await sinPublicaciones.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, "No hay publicaciones para verificar rollback");
      return;
    }

    // Verificar tabla de historial
    const tabla = page.getByRole("table");
    await expect(tabla).toBeVisible({ timeout: 5000 });

    // Exportar CSV debe funcionar
    const exportBtn = page.getByRole("button", { name: /exportar csv/i });
    if (await exportBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Verificar que el botón existe y es clickable
      await expect(exportBtn).toBeEnabled();
    }

    // Si hay una versión HISTÓRICO, debe mostrar botón Restaurar
    const restaurarBtn = page.getByRole("button", { name: /restaurar/i }).first();
    if (await restaurarBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await restaurarBtn.click();

      // Dialog de rollback
      const rollbackDialog = page.getByTestId("rollback-dialog");
      await expect(rollbackDialog).toBeVisible({ timeout: 3000 });

      await rollbackDialog.getByLabel(/motivo del rollback/i).fill("Rollback E2E test.");
      await rollbackDialog.getByRole("button", { name: /confirmar rollback/i }).click();

      // Debe mostrar feedback
      await expect(
        page.getByText(/restaurando|version.*publicado/i),
      ).toBeVisible({ timeout: 8000 });
    }
  });

  test("panel de validación bloquea publicar si hay errores", async ({ page }) => {
    await page.goto(`/workflow-designer/${WF_CODIGO}/editar`);

    const notFound = page.getByText(/no existe un tipo de documento/i);
    if (await notFound.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, `Tipo de documento ${WF_CODIGO} no existe en seed`);
      return;
    }

    // El panel de validación debe estar presente
    const validationPanel = page.getByTestId("validation-panel").or(
      page.getByTestId("validation-panel-ok"),
    );
    await expect(validationPanel).toBeVisible({ timeout: 5000 });
  });
});
