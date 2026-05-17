/**
 * E2E smoke — ECE: Consentimientos + Epicrisis.
 *
 * Cubre:
 *   - Navegación a listados ECE (page-load + elementos clave).
 *   - Wizard de nuevo consentimiento: paso 0 renderiza selector de tipo.
 *   - Formulario nueva epicrisis: secciones CIE-10 visibles.
 *   - Detalle epicrisis: badges de workflow visibles (con ID placeholder).
 *
 * Interacciones profundas (firma canvas + PIN real) se cubren cuando los seeds
 * de E2E incluyan personal_salud + firma_electronica configurada.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("ECE — Consentimientos", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("listado renderiza encabezado y banner de inmutabilidad", async ({ page }) => {
    await page.goto("/ece/consentimiento");
    await expect(page).toHaveURL(/\/ece\/consentimiento/);

    await expect(
      page.getByRole("heading", { name: /consentimientos informados/i }),
    ).toBeVisible();

    // Banner de documento inmutable post-firma
    await expect(page.getByText(/inmutable/i).first()).toBeVisible();

    // Botón nuevo consentimiento
    await expect(
      page.getByRole("link", { name: /nuevo consentimiento/i }),
    ).toBeVisible();
  });

  test("wizard nuevo consentimiento: paso 0 renderiza selector de tipo", async ({ page }) => {
    await page.goto("/ece/consentimiento/nuevo");
    await expect(page).toHaveURL(/\/ece\/consentimiento\/nuevo/);

    // Heading principal
    await expect(
      page.getByRole("heading", { name: /nuevo consentimiento informado/i }),
    ).toBeVisible();

    // Step indicator visible
    await expect(page.getByText(/tipo de documento/i).first()).toBeVisible();

    // Campo tipo (Select trigger)
    await expect(page.getByRole("combobox")).toBeVisible();

    // Campo paciente
    await expect(page.getByLabel(/paciente/i)).toBeVisible();

    // Banner inmutabilidad en el wizard
    await expect(page.getByText(/documento inmutable post-firma/i)).toBeVisible();
  });

  test("wizard: paso 0 valida campo tipo antes de avanzar", async ({ page }) => {
    await page.goto("/ece/consentimiento/nuevo");

    // Intentar avanzar sin seleccionar tipo
    await page.getByRole("button", { name: /siguiente/i }).click();

    // Mensaje de validación
    await expect(
      page.getByText(/seleccione el tipo de consentimiento/i),
    ).toBeVisible();
  });
});

test.describe("ECE — Epicrisis", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("listado renderiza encabezado y botón nueva epicrisis", async ({ page }) => {
    await page.goto("/ece/epicrisis");
    await expect(page).toHaveURL(/\/ece\/epicrisis/);

    await expect(
      page.getByRole("heading", { name: /epicrisis/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /nueva epicrisis/i }),
    ).toBeVisible();

    // Banner workflow MC→ESP→DIR
    await expect(page.getByText(/MC.*ESP.*DIR/i)).toBeVisible();
  });

  test("formulario nueva epicrisis renderiza todas las secciones", async ({ page }) => {
    await page.goto("/ece/epicrisis/nueva");
    await expect(page).toHaveURL(/\/ece\/epicrisis\/nueva/);

    await expect(
      page.getByRole("heading", { name: /nueva epicrisis/i }),
    ).toBeVisible();

    // Secciones presentes
    await expect(page.getByText(/resumen de ingreso/i)).toBeVisible();
    await expect(page.getByText(/evolución/i)).toBeVisible();
    await expect(page.getByText(/diagnóstico de egreso/i)).toBeVisible();
    await expect(page.getByText(/tratamiento al egreso/i)).toBeVisible();
    await expect(page.getByText(/indicaciones al paciente/i)).toBeVisible();

    // Campo CIE-10
    await expect(page.getByLabel(/código cie-10/i)).toBeVisible();

    // Banner inmutabilidad
    await expect(page.getByText(/inmutable post-firma/i)).toBeVisible();
  });

  test("formulario nueva epicrisis valida campos requeridos", async ({ page }) => {
    await page.goto("/ece/epicrisis/nueva");

    // Enviar sin datos
    await page.getByRole("button", { name: /guardar epicrisis/i }).click();

    // Al menos un mensaje de validación visible
    await expect(
      page.getByText(/paciente es requerido|requerido/i).first(),
    ).toBeVisible();
  });

  test("detalle epicrisis: smoke — la app no crashea con id placeholder", async ({ page }) => {
    // UUID placeholder — la query devolverá NOT_FOUND pero la app no debe 500.
    const resp = await page.goto("/ece/epicrisis/00000000-0000-0000-0000-000000000000");
    expect(resp?.status() ?? 0).toBeLessThan(500);

    // La navegación sigue disponible
    await expect(page.getByRole("navigation")).toBeVisible();

    // Heading de detalle visible (el componente maneja el error de la query)
    await expect(
      page.getByRole("heading", { name: /epicrisis/i }),
    ).toBeVisible();
  });

  test("sidebar ECE contiene links a consentimientos y epicrisis", async ({ page }) => {
    await page.goto("/ece/epicrisis");

    // Sección ECE en sidebar
    const nav = page.getByRole("navigation", { name: /principal/i });
    await expect(nav.getByRole("link", { name: /consentimientos ece/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /epicrisis/i })).toBeVisible();
  });
});
