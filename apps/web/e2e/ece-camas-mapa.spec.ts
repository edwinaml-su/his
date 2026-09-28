/**
 * E2E — ECE Mapa de Camas.
 *
 * `/ece/camas` fue consolidada a `/beds` (next.config.mjs, redirect 301,
 * "Remediación auditoría 2026-09-18: /ece/camas duplicaba /beds... Mismo
 * precedente que /ece/triaje (PR #101)"). Este spec quedó desactualizado
 * apuntando a la ruta legacy y a un shape de UI (selector de servicio por
 * combobox, grid con role=grid, modal "Asignar paciente" con campo "id
 * episodio hospitalario") que NO existe en `/beds` (confirmado: cero
 * ocurrencias de "métricas del servicio"/"mapa de camas del servicio"/
 * "Asignar paciente" en todo `apps/web/src/app`, 2026-09-27). Los 100%
 * de los 7 tests originales fallaban en la corrida real contra auth/DB
 * reales (baseline @QA 2026-09-27).
 *
 * Test 1 se reescribe para cubrir el REDIRECT en sí (sin cobertura previa).
 * Tests 2-7 quedan `test.fixme()`: no hay candidato de UI real al cual
 * apuntarlos sin adivinar — decisión de producto pendiente (@PO): ¿el
 * grid por servicio + modal de asignación de `/ece/camas` se re-implementa
 * en `/beds`, o la funcionalidad rica queda intencionalmente reducida al
 * listado simple que ya cubre `beds-ece-integration.spec.ts`?
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const MAPA_URL = "/ece/camas";

test.describe("ECE — Mapa de Camas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(MAPA_URL);
  });

  // 1 — Redirect 301 a /beds (consolidación 2026-09-18) + encabezado real.
  test("/ece/camas redirige a /beds y renderiza el mapa consolidado", async ({ page }) => {
    await expect(page).toHaveURL(/\/beds/);
    await expect(
      page.getByRole("heading", { name: /mapa de camas/i, level: 1 }),
    ).toBeVisible();
  });

  // 2-7 — UI legacy de /ece/camas (selector de servicio, grid role=grid,
  // modal "Asignar paciente") sin equivalente confirmado en /beds tras la
  // consolidación. Ver comentario de cabecera — reportado a @PO, no
  // adivinado.
  test("selector de servicio está visible y tiene opciones", async () => {
    test.fixme(
      true,
      "Combobox 'servicio' no existe en /beds — feature del /ece/camas legacy, sin candidato post-consolidación (ver cabecera).",
    );
  });

  test("sidebar contiene 'Mapa de Camas' bajo 'ECE — Hospitalario'", async () => {
    test.fixme(
      true,
      "Además del gap de UI: la aserción usaba getByRole('navigation', {name:/principal/i}) — el sidebar real (@his/ui Sidebar) usa role=menu/menuitem, nunca expone un landmark 'navigation' (ver hallazgo transversal en el reporte @QA 2026-09-27).",
    );
  });

  test("muestra zona de métricas con badge 'Total'", async () => {
    test.fixme(
      true,
      "role=status \"Métricas del servicio\" no existe en /beds — sin candidato post-consolidación (ver cabecera).",
    );
  });

  test("grid de camas tiene role=grid y celdas enfocables por teclado", async () => {
    test.fixme(
      true,
      "role=grid \"Mapa de camas del servicio\" no existe en /beds — sin candidato post-consolidación (ver cabecera).",
    );
  });

  test("click en cama libre abre modal 'Asignar paciente'", async () => {
    test.fixme(
      true,
      "Modal 'Asignar paciente' (con grid por servicio) no existe en /beds — sin candidato post-consolidación (ver cabecera). beds-ece-integration.spec.ts sí cubre un botón de asignación simple.",
    );
  });

  test("modal 'Asignar paciente' tiene campo episodio con label y botón submit", async () => {
    test.fixme(
      true,
      "Mismo modal legacy que el test anterior — sin candidato post-consolidación (ver cabecera).",
    );
  });
});
