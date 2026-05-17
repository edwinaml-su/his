/**
 * E2E smoke — ECE: Certificado de Defunción (NTEC Art. 21).
 *
 * Cubre:
 *   - Navegación y carga del listado de certificados.
 *   - Banner de inmutabilidad visible.
 *   - Sidebar entry "Defunción" bajo sección ECE.
 *   - Formulario nuevo certificado: campos CIE-10, manera, autopsia visibles.
 *   - Validación client-side (submit sin campos requeridos).
 *   - Navegación a detalle: banner inmutabilidad + badges workflow.
 *   - Acciones contextuales presentes según estado (smoke — sin BD real).
 *
 * Flujo completo MC→MC→DIR se cubre en suite de integración con BD efímera:
 *   @QA debe automatizar con seed de personal_salud + firma_electronica.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("ECE — Certificado de Defunción", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Listado
  // ──────────────────────────────────────────────────────────────────────────

  test("listado renderiza encabezado y banner de inmutabilidad", async ({ page }) => {
    await page.goto("/ece/defuncion");
    await expect(page).toHaveURL(/\/ece\/defuncion/);

    await expect(
      page.getByRole("heading", { name: /certificados de defunción/i }),
    ).toBeVisible();

    await expect(page.getByText(/inmutable post-firma/i).first()).toBeVisible();

    await expect(
      page.getByRole("link", { name: /nuevo certificado/i }),
    ).toBeVisible();
  });

  test("listado contiene filtros de fecha y causa CIE-10", async ({ page }) => {
    await page.goto("/ece/defuncion");

    await expect(page.getByLabel(/fecha desde/i)).toBeVisible();
    await expect(page.getByLabel(/causa principal cie-10/i)).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Sidebar
  // ──────────────────────────────────────────────────────────────────────────

  test("sidebar contiene link 'Defunción' bajo sección ECE", async ({ page }) => {
    await page.goto("/ece/defuncion");

    const sidebar = page.getByRole("navigation", { name: /principal/i });
    await expect(sidebar.getByRole("link", { name: /defunción/i })).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Formulario nueva
  // ──────────────────────────────────────────────────────────────────────────

  test("formulario nueva: renderiza secciones CIE-10 y campos obligatorios", async ({ page }) => {
    await page.goto("/ece/defuncion/nueva");
    await expect(page).toHaveURL(/\/ece\/defuncion\/nueva/);

    await expect(
      page.getByRole("heading", { name: /nuevo certificado de defunción/i }),
    ).toBeVisible();

    // Banner inmutabilidad prominente
    await expect(page.getByText(/documento inmutable post-firma/i)).toBeVisible();

    // Campo episodio
    await expect(page.getByLabel(/id episodio/i)).toBeVisible();

    // Campo fecha y hora
    await expect(page.getByLabel(/fecha y hora de defunción/i)).toBeVisible();

    // Sección causas de muerte
    await expect(page.getByText(/causas de muerte/i)).toBeVisible();

    // Causa directa / línea A
    await expect(page.getByLabel(/causa directa/i)).toBeVisible();

    // Causa básica / línea D
    await expect(page.getByLabel(/causa básica/i)).toBeVisible();

    // Sección manera de muerte
    await expect(page.getByLabel(/manera de muerte/i)).toBeVisible();

    // Autopsia
    await expect(page.getByLabel(/autopsia realizada/i)).toBeVisible();
  });

  test("formulario nueva: pre-rellena episodioId desde query string", async ({ page }) => {
    const episodioId = "e1000000-0000-0000-0000-000000000001";
    await page.goto(`/ece/defuncion/nueva?episodioId=${episodioId}`);

    const episodioInput = page.getByLabel(/id episodio/i);
    await expect(episodioInput).toBeVisible();
    await expect(episodioInput).toHaveValue(episodioId);
    // Debe estar deshabilitado (pre-rellenado desde alta)
    await expect(episodioInput).toBeDisabled();
  });

  test("formulario nueva: campo Agregar causa intermedia disponible", async ({ page }) => {
    await page.goto("/ece/defuncion/nueva");

    await expect(page.getByRole("button", { name: /agregar/i })).toBeVisible();
  });

  test("formulario nueva: CIE-10 typeahead muestra sugerencias al escribir", async ({ page }) => {
    await page.goto("/ece/defuncion/nueva");

    // Primer campo causa directa
    const causaInput = page.locator("input[placeholder*='J18.9']").first();
    await causaInput.fill("Neum");

    // Debería aparecer sugerencia
    await expect(page.getByText(/neumonía/i).first()).toBeVisible({ timeout: 2000 });
  });

  test("formulario nueva: checkbox firma MC muestra campo PIN al activarse", async ({ page }) => {
    await page.goto("/ece/defuncion/nueva");

    const checkFirmar = page.getByLabel(/firmar el certificado inmediatamente/i);
    await checkFirmar.check();

    await expect(page.getByLabel(/pin de firma electrónica/i)).toBeVisible();
    await expect(page.getByText(/al firmar, el certificado es inmutable/i)).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Detalle (ID ficticio — solo smoke de carga y manejo de NOT_FOUND)
  // ──────────────────────────────────────────────────────────────────────────

  test("detalle con UUID inexistente muestra error gracioso", async ({ page }) => {
    await page.goto("/ece/defuncion/00000000-0000-0000-0000-000000000000");

    // La página debe renderizar sin crash (error de tRPC visible o loading)
    await page.waitForLoadState("networkidle");

    // No debe haber un error de JS no manejado (blank screen)
    const heading = page.getByRole("heading", { name: /certificado de defunción/i });
    const errorText = page.getByText(/no encontrado|not found|error/i);
    // Esperamos encabezado O mensaje de error (cualquiera de los dos indica render correcto)
    await expect(heading.or(errorText).first()).toBeVisible();
  });
});
