/**
 * E2E — Publicación y rollback de workflow.
 * US.F2.2.06 (publicar), US.F2.2.19 (rollback), US.F2.2.20 (historial).
 *
 * Estado real (2026-08-28, ver docs/qa/inventario-componentes-huerfanos-2026-08-26.md
 * Tier 2): el flujo de publicación (`PublishDialog`, F2.2.06) está desacoplado
 * del motor de workflow y no tiene punto de montaje en /editar — decisión de
 * arquitectura pendiente, no se implementa en este lote. Los tests "publica un
 * workflow..." y "panel de validación bloquea publicar..." quedan `test.fixme`
 * con la razón inline. Solo "historial muestra versiones y permite rollback"
 * ejercita UI real (RollbackDialog), y únicamente verifica el registro de
 * auditoría del rollback, no la restauración operativa del workflow.
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

  test("publica un workflow y aparece en historial", async () => {
    // No existe botón "Publicar" (ni "Guardar borrador") en /editar — el flujo
    // de publicación (PublishDialog, F2.2.06) está desacoplado del motor de
    // workflow y su cableo es una decisión de arquitectura pendiente, fuera
    // del alcance de este lote (docs/qa/inventario-componentes-huerfanos-2026-08-26.md
    // Tier 2). No implementar aquí — solo desmentir el falso verde.
    test.fixme(
      true,
      "No hay botón Publicar en /editar — PublishDialog no está cableado, flujo de publicación desacoplado del motor (decisión de arquitectura pendiente).",
    );
  });

  // Este test ejercita UI real (historial/page.tsx + RollbackDialog) y queda
  // habilitado, pero ojo: sin publicaciones previas (el test de arriba que las
  // crearía está en fixme) la rama de rollback normalmente no se ejecuta. Y
  // aunque se ejecute, solo verifica que el registro de auditoría del rollback
  // se crea — NO que el workflow operativo quede efectivamente restaurado.
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

  test("panel de validación bloquea publicar si hay errores", async () => {
    // ValidationPanel SÍ está montado, pero en /workflow-designer/[codigo]
    // (vista de grafo) — NO en /editar (vista de tabla), que es donde este
    // test navega. Los testids "validation-panel"/"validation-panel-ok" del
    // panel real nunca aparecen en /editar; el test verificaba un panel
    // huérfano en la ruta equivocada, no el flujo "bloquea publicar" (que no
    // existe — ver fixme de "publica un workflow y aparece en historial").
    test.fixme(
      true,
      "ValidationPanel vive en /workflow-designer/[codigo], no en /editar — el test asertaba sobre la ruta equivocada y sobre un flujo de publicar que no existe.",
    );
  });
});
