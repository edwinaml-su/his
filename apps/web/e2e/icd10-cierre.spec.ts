/**
 * E2E — ICD-10 Picker + Hard-stop cierre epicrisis.
 *
 * US.F2.7.33 — Búsqueda catálogo CIE-10.
 * US.F2.7.34 — Hard-stop: no se puede firmar epicrisis sin CIE-10 principal.
 * US.F2.7.35 — Advertencia combinaciones inválidas.
 *
 * Realidad montada (huérfanos Tier 1, docs/qa/inventario-componentes-huerfanos-2026-08-26.md):
 * `ICD10Picker` vive en `/ece/epicrisis/[id]` (sección "Diagnóstico CIE-10 de
 * cierre", solo en estado `borrador`), NO en `/ece/epicrisis/nueva` — el
 * wizard de creación captura `diagnosticos_egreso` como texto libre, un
 * campo distinto de `cie10_principal`/`cie10_secundarios` (los que el
 * servidor exige en `eceEpicrisis.firmar`, PRECONDITION_FAILED si faltan).
 *
 * Casos:
 *   ICD-01: El picker autocomplete retorna resultados al escribir "J06"
 *   ICD-02: Seleccionar ítem del picker llena el campo con el código
 *   ICD-03: Búsqueda por texto libre "diabetes" retorna resultados
 *   ICD-04: Código inválido "ZZZ9" no aparece en sugerencias (catálogo no lo tiene)
 *   ICD-05: Sin CIE-10 principal, "Firmar como MC" está deshabilitado y se
 *           muestra el mensaje de hard-stop (Art. 17 NTEC)
 *   ICD-06: Tras guardar el CIE-10 de cierre, aparece como badge y habilita el botón de firma
 *
 * Prerrequisito de seed:
 *   - Catálogo ICD-10 cargado (seed-icd10.mjs).
 *   - Al menos una epicrisis en estado 'borrador' visible en /ece/epicrisis
 *     para el usuario qa.physician@his.test (rol MC).
 *   Si no hay ninguna, los tests se saltan explícitamente (no fallan en falso).
 */
import { test, expect, type Page } from "@playwright/test";
import { login } from "./_helpers/auth";

const ROUTE_EPICRISIS_LIST = "/ece/epicrisis";

/**
 * Navega al listado de epicrisis y abre la primera en estado "Borrador".
 * Devuelve `false` (sin navegar más allá del listado) si no hay ninguna —
 * las specs deben saltarse explícitamente en ese caso, no fingir un pase.
 */
async function abrirEpicrisisBorrador(page: Page): Promise<boolean> {
  await page.goto(ROUTE_EPICRISIS_LIST);

  const filaBorrador = page
    .getByRole("row")
    .filter({ has: page.getByText("Borrador", { exact: true }) })
    .first();

  if ((await filaBorrador.count()) === 0) return false;

  await filaBorrador.getByRole("link", { name: /ver \/ firmar/i }).click();
  await expect(page.getByRole("heading", { name: "Epicrisis de Egreso" })).toBeVisible({
    timeout: 8_000,
  });
  return true;
}

function cie10PrincipalInput(page: Page) {
  return page.getByRole("combobox", { name: "CIE-10 principal" });
}

test.describe("ICD-10 — Picker autocomplete (epicrisis, cierre)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "physician");
  });

  test("ICD-01: Picker muestra resultados al escribir código J06", async ({ page }) => {
    const ok = await abrirEpicrisisBorrador(page);
    test.skip(!ok, "Sin epicrisis en estado borrador disponible para el seed actual.");

    const inputEl = cie10PrincipalInput(page);
    await expect(inputEl).toBeVisible({ timeout: 8_000 });
    await inputEl.fill("J06");

    const listbox = page.getByRole("listbox", { name: "Resultados CIE-10" });
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("option").first()).toBeVisible();
  });

  test("ICD-02: Seleccionar ítem del picker llena el campo con el código", async ({ page }) => {
    const ok = await abrirEpicrisisBorrador(page);
    test.skip(!ok, "Sin epicrisis en estado borrador disponible para el seed actual.");

    const inputEl = cie10PrincipalInput(page);
    await inputEl.fill("J06");

    await expect(page.getByRole("listbox", { name: "Resultados CIE-10" })).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("option").first().click();

    await expect(inputEl).toHaveValue(/^J06/);
  });

  test("ICD-03: Búsqueda por texto libre retorna resultados", async ({ page }) => {
    const ok = await abrirEpicrisisBorrador(page);
    test.skip(!ok, "Sin epicrisis en estado borrador disponible para el seed actual.");

    const inputEl = cie10PrincipalInput(page);
    await inputEl.fill("diabetes");

    await expect(page.getByRole("listbox", { name: "Resultados CIE-10" })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole("option")).not.toHaveCount(0);
  });

  test("ICD-04: Código inexistente ZZZ9 no genera sugerencias seleccionables", async ({ page }) => {
    const ok = await abrirEpicrisisBorrador(page);
    test.skip(!ok, "Sin epicrisis en estado borrador disponible para el seed actual.");

    const inputEl = cie10PrincipalInput(page);
    await inputEl.fill("ZZZ9");

    await expect(page.getByText("Sin resultados para “ZZZ9”")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole("option")).toHaveCount(0);
  });
});

test.describe("ICD-10 — Hard-stop de firma sin CIE-10 (Art. 17 NTEC)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "physician");
  });

  test("ICD-05: Sin CIE-10 principal, el botón de firma está deshabilitado con el aviso visible", async ({
    page,
  }) => {
    const ok = await abrirEpicrisisBorrador(page);
    test.skip(!ok, "Sin epicrisis en estado borrador disponible para el seed actual.");

    const btnFirmar = page.getByRole("button", { name: "Firmar epicrisis como Médico Cirujano" });

    // Si esta epicrisis del seed ya trae CIE-10 asignado, el hard-stop no
    // aplica en este documento — el caso se cubre en ICD-06 con el mismo seed.
    const yaTieneCie10 = (await page.getByText("CIE-10 cierre:").count()) > 0;
    test.skip(yaTieneCie10, "La epicrisis borrador del seed ya tiene CIE-10 principal asignado.");

    await expect(btnFirmar).toBeDisabled();
    await expect(
      page.getByRole("alert", {
        name: "Debe asignar el diagnóstico CIE-10 principal antes de firmar (Art. 17 NTEC).",
      }),
    ).toBeVisible();
  });

  test("ICD-06: Guardar CIE-10 de cierre muestra el badge y habilita la firma", async ({ page }) => {
    const ok = await abrirEpicrisisBorrador(page);
    test.skip(!ok, "Sin epicrisis en estado borrador disponible para el seed actual.");

    const yaTieneCie10 = (await page.getByText("CIE-10 cierre:").count()) > 0;
    test.skip(yaTieneCie10, "La epicrisis borrador del seed ya tiene CIE-10 principal asignado.");

    const inputEl = cie10PrincipalInput(page);
    await inputEl.fill("I10");
    await expect(page.getByRole("listbox", { name: "Resultados CIE-10" })).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("option").first().click();

    await page.getByRole("button", { name: "Guardar CIE-10 de cierre" }).click();

    await expect(page.getByText("CIE-10 cierre:")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[aria-label="CIE-10 principal: I10"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Firmar epicrisis como Médico Cirujano" }),
    ).toBeEnabled();
  });
});
