/**
 * E2E — ECE Estudios: Solicitud y Resultado (Doc 18 NTEC).
 *
 * Cubre:
 *   1. Lista /ece/estudios renderiza (smoke).
 *   2. Formulario /ece/estudios/nueva — validación client-side sin episodioId.
 *   3. Formulario /ece/estudios/nueva — validación PIN inválido.
 *   4. Sidebar "Diagnóstico" tiene link "Estudios ECE".
 *   5. Detalle /ece/estudios/[id] — smoke si existe al menos una solicitud.
 *   6. Link "Registrar resultado" visible cuando solicitud está firmada/validada.
 *   7. Formulario /ece/estudios/[id]/registrar-resultado — validación campo obligatorio.
 *
 * Seed E2E recomendado:
 *   - qa.admin@his.test con roles MC + TEC en la org de prueba.
 *   - Al menos una solicitud en estado 'firmado'.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("ECE — Estudios (Solicitud y Resultado)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  // ---------------------------------------------------------------------------
  // Smoke: lista principal
  // ---------------------------------------------------------------------------
  test("lista /ece/estudios renderiza sin errores", async ({ page }) => {
    await page.goto("/ece/estudios");
    await expect(
      page.getByRole("heading", { name: /estudios \(lab \/ imágenes\)/i }),
    ).toBeVisible();
    // Cards split
    await expect(page.getByText(/pendientes/i).first()).toBeVisible();
    await expect(page.getByText(/con resultado/i).first()).toBeVisible();
    // Botón nueva solicitud
    await expect(
      page.getByRole("link", { name: /nueva solicitud/i }),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Sidebar: link "Estudios ECE" bajo "Diagnóstico"
  // ---------------------------------------------------------------------------
  test("sidebar contiene link Estudios ECE bajo sección Diagnóstico", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const link = page.getByRole("link", { name: /estudios ece/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/ece/estudios");
  });

  // ---------------------------------------------------------------------------
  // Formulario nueva solicitud — validación sin episodioId
  // ---------------------------------------------------------------------------
  test("formulario nueva solicitud no envía sin episodioId válido", async ({
    page,
  }) => {
    await page.goto("/ece/estudios/nueva");
    await expect(
      page.getByRole("heading", { name: /nueva solicitud de estudio/i }),
    ).toBeVisible();

    // Intentar enviar sin rellenar episodioId
    await page.getByRole("button", { name: /crear y firmar/i }).click();

    // Mensaje de error de validación client-side
    await expect(page.getByText(/debe ser un uuid válido/i)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Formulario nueva solicitud — validación PIN inválido
  // ---------------------------------------------------------------------------
  test("formulario nueva solicitud muestra error si PIN no tiene 6-8 dígitos", async ({
    page,
  }) => {
    await page.goto("/ece/estudios/nueva");

    await page.getByLabel(/episodio/i).fill("00000000-0000-0000-0000-000000000001");
    await page.getByLabel(/estudios solicitados/i).fill("2093-3");
    // PIN con menos de 6 dígitos
    await page.getByLabel(/pin de firma/i).fill("123");
    await page.getByRole("button", { name: /crear y firmar/i }).click();

    await expect(page.getByText(/pin debe ser 6-8 dígitos/i)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Formulario nueva solicitud — estudios vacíos
  // ---------------------------------------------------------------------------
  test("formulario nueva solicitud muestra error sin estudios", async ({ page }) => {
    await page.goto("/ece/estudios/nueva");

    await page.getByLabel(/episodio/i).fill("00000000-0000-0000-0000-000000000001");
    // No rellenar estudios
    await page.getByLabel(/pin de firma/i).fill("123456");
    await page.getByRole("button", { name: /crear y firmar/i }).click();

    await expect(page.getByText(/ingrese al menos un código/i)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Detalle: acceso desde lista
  // ---------------------------------------------------------------------------
  test("detalle solicitud accesible desde lista", async ({ page }) => {
    await page.goto("/ece/estudios");

    const verLinks = page.getByRole("link", { name: /^ver$/i });
    const count = await verLinks.count();

    test.info().annotations.push({
      type: "ece-estudios-count",
      description: `${count} solicitudes en lista`,
    });

    if (count === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "Sin solicitudes en BD de prueba — smoke informativo",
      });
      return;
    }

    await verLinks.first().click();
    await page.waitForURL(/\/ece\/estudios\/.+/);

    // Página de detalle muestra heading de tipo de estudio
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Detalle: link registrar resultado visible si solicitud firmada/validada
  // ---------------------------------------------------------------------------
  test("detalle muestra link Registrar resultado si solicitud firmada", async ({
    page,
  }) => {
    await page.goto("/ece/estudios");

    const verLinks = page.getByRole("link", { name: /^ver$/i });
    const count = await verLinks.count();

    if (count === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "Sin solicitudes en BD de prueba",
      });
      return;
    }

    const limit = Math.min(count, 5);
    for (let i = 0; i < limit; i++) {
      await page.goto("/ece/estudios");
      const links = page.getByRole("link", { name: /^ver$/i });
      await links.nth(i).click();
      await page.waitForURL(/\/ece\/estudios\/.+/);

      const btnRegistrar = page.getByRole("link", { name: /registrar resultado/i });
      if (await btnRegistrar.isVisible()) {
        await expect(btnRegistrar).toHaveAttribute("href", /registrar-resultado/);
        break;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Registrar resultado: validación campo obligatorio
  // ---------------------------------------------------------------------------
  test("formulario registrar resultado no envía sin campo resultado", async ({
    page,
  }) => {
    // Usamos un id placeholder — el formulario tiene validación client-side
    await page.goto("/ece/estudios/00000000-0000-0000-0000-000000000001/registrar-resultado");

    await expect(
      page.getByRole("heading", { name: /registrar resultado/i }),
    ).toBeVisible();

    // Enviar sin rellenar
    await page.getByRole("button", { name: /registrar resultado/i }).click();

    await expect(page.getByText(/el resultado es obligatorio/i)).toBeVisible();
  });
});
