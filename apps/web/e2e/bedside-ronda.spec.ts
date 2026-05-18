/**
 * E2E — Bedside Modo Rondas (US.F2.6.46, 50, 51)
 *
 * Smoke E2E: la ruta /bedside/ronda carga correctamente para un usuario
 * de enfermería, muestra el selector de modo y el botón de inicio.
 *
 * Los tests deep (start → pause → resume → complete con BD efímera)
 * quedan marcados como @QA para automatización E2E con seed completo.
 */

import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("Bedside Modo Rondas", () => {
  test.beforeEach(async ({ page }) => {
    // Usa usuario de enfermería (qa.triagist tiene rol clínico)
    await login(page, "triagist");
  });

  test("ruta /bedside/ronda renderiza el selector de modo y botón iniciar", async ({
    page,
  }) => {
    await page.goto("/bedside/ronda");

    // El heading debe existir
    await expect(page.getByRole("heading", { name: /modo rondas/i })).toBeVisible();

    // Los dos modos deben estar presentes
    const modoPorHora = page.getByRole("button", { name: /por hora/i });
    const modoPorUbicacion = page.getByRole("button", { name: /por ubicacion/i });
    await expect(modoPorHora).toBeVisible();
    await expect(modoPorUbicacion).toBeVisible();

    // El botón de inicio debe estar presente
    await expect(page.getByRole("button", { name: /iniciar ronda/i })).toBeVisible();
  });

  test("toggle modo cambia la descripcion del orden", async ({ page }) => {
    await page.goto("/bedside/ronda");

    // Default: POR_HORA seleccionado
    await expect(
      page.getByText(/ordenan por hora programada/i),
    ).toBeVisible();

    // Cambiar a POR_UBICACION
    await page.getByRole("button", { name: /por ubicacion/i }).click();
    await expect(
      page.getByText(/minimizar desplazamientos/i),
    ).toBeVisible();
  });

  test("ruta /bedside/ronda es accesible sin errores de consola críticos", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/bedside/ronda");
    // Espera render inicial
    await page.waitForTimeout(1000);

    // No debe haber errores JS críticos no relacionados con auth/seed
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("UNAUTHORIZED") &&
        !e.includes("FORBIDDEN") &&
        !e.includes("fetch failed"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  /**
   * @QA — Para automatizar con seed de BD efímera:
   *  1. Seed: crear indicación activa para paciente en turno.
   *  2. Iniciar ronda → verificar que aparece la tarjeta de indicación.
   *  3. Click "Siguiente" → progreso 1/1 → ronda completada.
   *  4. Click "Pausar ronda" → diálogo aparece → confirmar → estado PAUSADA.
   *  5. Click "Reanudar" → estado activo restaurado.
   *  6. Verificar que el toggle POR_UBICACION ordena por número de cama.
   */
});
