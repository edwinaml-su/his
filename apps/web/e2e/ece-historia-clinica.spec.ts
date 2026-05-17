/**
 * E2E — ECE Historia Clínica Electrónica.
 * US: ECE-01 (listado filtrable), ECE-02 (formulario nueva HC),
 *     ECE-03 (validación campos requeridos).
 *
 * Smoke básico: navegación, renderizado de elementos clave y validación
 * de requeridos en el formulario antes de submit.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("ECE — Historia Clínica Electrónica", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("ECE-01: listado carga y muestra controles básicos", async ({ page }) => {
    await page.goto("/ece/historia-clinica");

    // Cabecera presente
    await expect(
      page.getByRole("heading", { name: /historia cl[ií]nica electr[oó]nica/i }),
    ).toBeVisible();

    // Botón de creación
    await expect(
      page.getByRole("link", { name: /nueva hc/i }),
    ).toBeVisible();

    // Filtro de estado existe y es accesible
    await expect(page.getByLabel(/estado/i)).toBeVisible();
  });

  test("ECE-02: formulario nueva HC renderiza todas las secciones", async ({
    page,
  }) => {
    await page.goto("/ece/historia-clinica/nueva");

    await expect(
      page.getByRole("heading", { name: /nueva historia cl[ií]nica/i }),
    ).toBeVisible();

    // Sección datos generales
    await expect(page.getByRole("heading", { name: /datos generales/i })).toBeVisible();
    await expect(page.getByLabel(/motivo de consulta/i)).toBeVisible();
    await expect(page.getByLabel(/antecedentes personales/i)).toBeVisible();
    await expect(page.getByLabel(/antecedentes familiares/i)).toBeVisible();
    await expect(page.getByLabel(/antecedentes sociales/i)).toBeVisible();

    // Sección examen físico
    await expect(page.getByRole("heading", { name: /examen f[ií]sico/i })).toBeVisible();
    await expect(page.getByLabel(/pa sist[oó]lica/i)).toBeVisible();
    await expect(page.getByLabel(/hallazgos por aparato/i)).toBeVisible();

    // Sección diagnósticos
    await expect(page.getByRole("heading", { name: /diagn[oó]sticos/i })).toBeVisible();
    await expect(page.getByLabel(/c[oó]digo cie-10/i)).toBeVisible();

    // Sección plan terapéutico
    await expect(page.getByRole("heading", { name: /plan terap[eé]utico/i })).toBeVisible();

    // Botón submit presente
    await expect(
      page.getByRole("button", { name: /guardar borrador/i }),
    ).toBeVisible();
  });

  test("ECE-03: valida campos requeridos antes de enviar", async ({ page }) => {
    await page.goto("/ece/historia-clinica/nueva");

    // Enviar sin datos → debe mostrar error de validación
    await page.getByRole("button", { name: /guardar borrador/i }).click();

    await expect(
      page.getByRole("alert"),
    ).toContainText(/paciente es requerido|motivo de consulta es requerido/i);
  });

  test("ECE-04: agrega y elimina diagnóstico en formulario", async ({ page }) => {
    await page.goto("/ece/historia-clinica/nueva");

    // Ingresa un diagnóstico
    await page.getByLabel(/c[oó]digo cie-10/i).fill("J18.9");
    await page.getByLabel(/descripci[oó]n/i).fill("Neumonía no especificada");
    await page.getByRole("button", { name: /agregar/i }).click();

    // Debe aparecer en la lista con el código
    const listItem = page.getByRole("listitem").filter({ hasText: "J18.9" });
    await expect(listItem).toBeVisible();

    // Eliminar
    await page.getByRole("button", { name: /eliminar diagn[oó]stico J18\.9/i }).click();
    await expect(listItem).not.toBeVisible();
  });
});
