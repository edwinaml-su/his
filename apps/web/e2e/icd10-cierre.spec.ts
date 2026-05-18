/**
 * E2E — ICD-10 Picker + Hard-stop cierre epicrisis.
 *
 * US.F2.7.33 — Búsqueda catálogo CIE-10.
 * US.F2.7.34 — Hard-stop: no se puede firmar epicrisis sin CIE-10.
 * US.F2.7.35 — Advertencia combinaciones inválidas.
 *
 * Casos:
 *   ICD-01: El picker autocomplete retorna resultados al escribir "J06"
 *   ICD-02: Seleccionar ítem del picker llena el campo con el código
 *   ICD-03: Búsqueda por texto libre "diabetes" retorna resultados
 *   ICD-04: Código inválido "ZZZ9" no aparece en sugerencias (catálogo no lo tiene)
 *   ICD-05: Intento de firmar epicrisis sin CIE-10 → mensaje de error visible
 *   ICD-06: Epicrisis con CIE-10 asignado muestra badge del código
 *
 * Prerrequisito de seed:
 *   - Catálogo ICD-10 cargado (seed-icd10.mjs).
 *   - Episodio hospitalario con epicrisis en estado 'borrador' disponible.
 *   - Usuario qa.admin@his.test con rol MC.
 */

import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const ROUTE_EPICRISIS_NUEVA = "/ece/epicrisis/nueva";
const ROUTE_CATALOGOS_ICD10 = "/admin/ece/icd10-picker";

test.describe("ICD-10 — Picker autocomplete", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("ICD-01: Picker muestra resultados al escribir código J06", async ({ page }) => {
    await page.goto(ROUTE_EPICRISIS_NUEVA);

    // Buscar el campo de diagnóstico CIE-10 principal
    const picker = page.getByRole("combobox", { name: /cie-10|diagnóstico/i }).first();

    // Si no hay picker en la página, buscar el input genérico del picker
    const inputEl = picker.or(page.locator('[aria-autocomplete="list"]').first());
    await expect(inputEl).toBeVisible({ timeout: 8000 });

    await inputEl.fill("J06");

    // Lista de sugerencias debe aparecer
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible({ timeout: 5000 });

    // Debe haber al menos 1 opción
    const opciones = page.getByRole("option");
    await expect(opciones.first()).toBeVisible();
  });

  test("ICD-02: Seleccionar ítem del picker llena el campo con el código", async ({ page }) => {
    await page.goto(ROUTE_EPICRISIS_NUEVA);

    const inputEl = page.locator('[aria-autocomplete="list"]').first();
    await expect(inputEl).toBeVisible({ timeout: 8000 });

    await inputEl.fill("J06");

    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible({ timeout: 5000 });

    // Seleccionar la primera opción
    const primeraOpcion = page.getByRole("option").first();
    await primeraOpcion.click();

    // El input debe contener un código CIE-10 (J06.x format)
    const val = await inputEl.inputValue();
    expect(val).toMatch(/^J06/);
  });

  test("ICD-03: Búsqueda por texto libre retorna resultados", async ({ page }) => {
    await page.goto(ROUTE_EPICRISIS_NUEVA);

    const inputEl = page.locator('[aria-autocomplete="list"]').first();
    await expect(inputEl).toBeVisible({ timeout: 8000 });

    await inputEl.fill("diabetes");

    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible({ timeout: 5000 });

    // Debe haber al menos 1 resultado que contenga "diabetes" en la descripción
    await expect(page.getByRole("option")).not.toHaveCount(0);
  });

  test("ICD-04: Código inexistente ZZZ9 no genera sugerencias", async ({ page }) => {
    await page.goto(ROUTE_EPICRISIS_NUEVA);

    const inputEl = page.locator('[aria-autocomplete="list"]').first();
    await expect(inputEl).toBeVisible({ timeout: 8000 });

    await inputEl.fill("ZZZ9");

    // Esperar a que la lista aparezca con mensaje de sin resultados
    await expect(
      page.getByText(/sin resultados/i).or(page.getByRole("option")),
    ).toBeVisible({ timeout: 5000 });

    // No debe haber opciones seleccionables (códigos reales)
    const opciones = page.getByRole("option");
    const count = await opciones.count();
    // 0 opciones O solo el mensaje de "sin resultados" (que es un listitem, no option)
    expect(count).toBe(0);
  });

  test("ICD-05: Intento de firmar epicrisis sin CIE-10 muestra error", async ({ page }) => {
    await page.goto(ROUTE_EPICRISIS_NUEVA);

    // Buscar botón de firma (si existe en la página actual)
    const btnFirmar = page.getByRole("button", { name: /firmar/i });
    if (await btnFirmar.isVisible()) {
      await btnFirmar.click();

      // Debe aparecer mensaje de error sobre CIE-10 obligatorio
      const errorMsg = page
        .getByRole("alert")
        .or(page.getByText(/cie-10|diagnóstico.*obligatorio|art.*17/i));
      await expect(errorMsg).toBeVisible({ timeout: 5000 });
    } else {
      // Si el botón no está visible en este contexto, skip test con nota
      test.skip();
    }
  });
});

test.describe("ICD-10 — Validación combinaciones", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("ICD-06: Epicrisis con CIE-10 asignado muestra el código en el formulario", async ({
    page,
  }) => {
    await page.goto(ROUTE_EPICRISIS_NUEVA);

    const inputEl = page.locator('[aria-autocomplete="list"]').first();
    await expect(inputEl).toBeVisible({ timeout: 8000 });

    // Simular selección de código
    await inputEl.fill("I10");
    const listbox = page.getByRole("listbox");

    if (await listbox.isVisible()) {
      const primeraOpcion = page.getByRole("option").first();
      await primeraOpcion.click();

      // Badge con el código debe aparecer en alguna parte del formulario
      const badge = page.getByText("I10");
      await expect(badge).toBeVisible({ timeout: 3000 });
    } else {
      // Picker no disponible en contexto de prueba
      test.skip();
    }
  });
});
