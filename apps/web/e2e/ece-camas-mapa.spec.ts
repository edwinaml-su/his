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
 *
 * Los 6 `test.fixme()` usan la forma DECLARATIVA (`test.fixme("título", body)`)
 * en vez de `test.fixme(true, razón)` dentro del cuerpo — con la forma
 * declarativa Playwright marca el test como skip ANTES de ejecutar, así que
 * ni el `body` ni el `beforeEach` (login + goto) corren. Con la forma
 * inline, los 6 fixme SÍ ejecutaban el login+goto completo del describe
 * (aunque el resto del body nunca corriera) — gasto innecesario en un
 * nightly serial (`workers:1`) — hallazgo @QA (2026-09-28). Por eso viven
 * en su propio `describe` sin `beforeEach`.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const MAPA_URL = "/ece/camas";

// 1 — único test que necesita sesión real (login + goto) — describe propio
// para no compartir beforeEach con los fixme de abajo.
test.describe("ECE — Mapa de Camas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(MAPA_URL);
  });

  // Redirect 301 a /beds (consolidación 2026-09-18) + encabezado real.
  test("/ece/camas redirige a /beds y renderiza el mapa consolidado", async ({ page }) => {
    await expect(page).toHaveURL(/\/beds/);
    await expect(
      page.getByRole("heading", { name: /mapa de camas/i, level: 1 }),
    ).toBeVisible();
  });
});

// 2-7 — UI legacy de /ece/camas (selector de servicio, grid role=grid,
// modal "Asignar paciente") sin equivalente confirmado en /beds tras la
// consolidación. Ver comentario de cabecera — reportado a @PO, no
// adivinado. Sin beforeEach: la forma declarativa de test.fixme() ya evita
// que corran (body incluido), así que login+goto serían trabajo tirado.
test.describe("ECE — Mapa de Camas (fixme — sin candidato post-consolidación)", () => {
  test.fixme(
    "selector de servicio está visible y tiene opciones",
    async () => {
      throw new Error("no debería ejecutarse — test.fixme declarativo");
    },
  );

  test.fixme(
    "sidebar contiene 'Mapa de Camas' bajo 'ECE — Hospitalario'",
    async () => {
      // Causa real: la aserción usaba getByRole('navigation', {name:/principal/i}),
      // pero el sidebar real (@his/ui Sidebar) usa role=menu/menuitem y nunca
      // expone un landmark 'navigation' — hallazgo transversal, no específico
      // de esta página (ver reporte @QA 2026-09-27). El gap de UI de
      // /ece/camas (cabecera de este archivo) es secundario acá.
      throw new Error("no debería ejecutarse — test.fixme declarativo");
    },
  );

  test.fixme(
    "muestra zona de métricas con badge 'Total'",
    async () => {
      throw new Error("no debería ejecutarse — test.fixme declarativo");
    },
  );

  test.fixme(
    "grid de camas tiene role=grid y celdas enfocables por teclado",
    async () => {
      throw new Error("no debería ejecutarse — test.fixme declarativo");
    },
  );

  test.fixme(
    "click en cama libre abre modal 'Asignar paciente'",
    async () => {
      throw new Error("no debería ejecutarse — test.fixme declarativo");
    },
  );

  test.fixme(
    "modal 'Asignar paciente' tiene campo episodio con label y botón submit",
    async () => {
      throw new Error("no debería ejecutarse — test.fixme declarativo");
    },
  );
});
