/**
 * E2E — Mapa de camas.
 * US: BED-01 (mapa), BED-02 (detalle de cama).
 *
 * 2026-08-28: alineado a la UI actual — /beds renderiza el mapa ECE
 * (eceCama.mapCompleto sobre public."Bed" + ece.asignacion_cama) y el click
 * en una cama ocupada NAVEGA a /ece/episodio-hospitalario/{episodioId}
 * (beds/page.tsx onBedClick); ya no existe el drawer con nº de encuentro.
 * Datos: seed-e2e-fixtures.mjs (camas E2E-01..06, ocupada = E2E-02).
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";
import { E2E_FIXTURES } from "./_helpers/fixtures";

test.describe("@smoke - Mapa de camas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("mapa renderiza servicios y camas con estado coherente", async ({ page }) => {
    await page.goto("/beds");

    // Cada estado tiene texto/aria-label, no solo color (BedMap STATUS_LABEL:
    // Libre / Ocupada / Limpieza / Mantenimiento — RESERVED se muestra "Libre"
    // en el mapa ECE, ver cama.router.ts resolverEstado).
    await expect(
      page.getByText(/libre|ocupada|limpieza|mantenimiento/i).first(),
    ).toBeVisible();

    // Las camas son botones accesibles por nombre ("Cama E2E-01 — Libre").
    const bedButtons = page.getByRole("button", { name: /cama/i });
    await expect(bedButtons.first()).toBeVisible();
  });

  test("click en cama ocupada navega al episodio hospitalario del ocupante", async ({ page }) => {
    await page.goto("/beds");

    // La cama ocupada expone el nombre del paciente en su accessible name
    // ("Cama E2E-02 — Ocupada — María Pérez").
    const occupied = page.getByRole("button", { name: /cama.*ocupada/i }).first();
    await expect(occupied).toBeVisible();
    await occupied.click();

    // beds/page.tsx: onBedClick → router.push(/ece/episodio-hospitalario/{id}).
    await page.waitForURL(
      new RegExp(`/ece/episodio-hospitalario/${E2E_FIXTURES.episodioHospitalarioId}`),
    );
  });
});
