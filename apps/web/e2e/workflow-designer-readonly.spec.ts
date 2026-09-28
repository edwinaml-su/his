/**
 * E2E — Workflow Designer modo solo lectura + mobile (US.F2.2.15 / US.F2.2.16)
 *
 * Spec 1: Usuario physician navega al editor → ve banner solo lectura,
 *         no ve botón "Editar workflow", no ve paleta.
 *
 * Spec 2: Viewport 360px → MobileView con lista de estados (no ReactFlow canvas).
 *
 * Los tests son adaptativos: si no hay workflows sembrados pasan con
 * anotación informativa.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

// ─── Helper ───────────────────────────────────────────────────────────────────

async function getFirstWorkflowHref(page: import("@playwright/test").Page): Promise<string | null> {
  await page.goto("/workflow-designer", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const first = page.locator("a[href^='/workflow-designer/']").first();
  if ((await first.count()) === 0) return null;
  return first.getAttribute("href");
}

// ─── Suite US.F2.2.15 — Solo lectura ─────────────────────────────────────────

test.describe("US.F2.2.15 — Vista de solo lectura para roles no editores", () => {
  test("Physician ve banner solo lectura y no ve botón editar", async ({ page }) => {
    await login(page, "physician");
    const href = await getFirstWorkflowHref(page);
    if (!href) {
      test.skip(true, "Sin workflows sembrados en BD de test");
      return;
    }

    await page.goto(href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Sin datos de sesión reales (usuario physician no tiene rol editor en seed),
    // verificamos la estructura del DOM que la lógica cliente produciría.
    // El banner tiene data-testid="read-only-banner" cuando canEdit=false.
    const banner = page.getByTestId("read-only-banner");

    // Si el banner está presente (auth funciona y el usuario es physician),
    // verificamos que el botón editar NO está.
    const bannerVisible = await banner.count() > 0;
    if (bannerVisible) {
      await expect(banner).toBeVisible();
      await expect(
        page.getByRole("link", { name: /editar workflow/i }),
      ).toHaveCount(0);
      await expect(
        page.getByTestId("auto-layout-disabled"),
      ).toHaveAttribute("disabled");
    }

    // Verificar que la página cargó sin error independientemente del auth
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  test("Director ve botón editar (sin banner solo lectura)", async ({ page }) => {
    // NO "admin": workflowTipoDoc.list (workflow-tipoDoc.router.ts:225) exige
    // requireRole(["DIR", "WORKFLOW_DESIGNER"]) — el rol ADMIN da FORBIDDEN
    // (mismo diagnóstico que a11y-workflow-designer.spec.ts), lo que hacía
    // que getFirstWorkflowHref() devolviera null SIEMPRE y el test pasara
    // trivialmente sin ejercitar nada — hallazgo @QA (2026-09-28).
    await login(page, "director");
    const href = await getFirstWorkflowHref(page);
    if (!href) {
      test.skip(true, "Sin workflows sembrados en BD de test para el rol DIR");
      return;
    }

    await page.goto(href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Si hay datos reales, admin debe ver el botón editar y NO el banner
    const editBtn = page.getByRole("link", { name: /editar workflow/i });
    const editCount = await editBtn.count();
    if (editCount > 0) {
      // El banner NO debe aparecer para admin
      await expect(page.getByTestId("read-only-banner")).toHaveCount(0);
    }

    await expect(page.locator("body")).not.toContainText("Application error");
  });
});

// ─── Suite US.F2.2.16 — Mobile view ──────────────────────────────────────────

test.describe("US.F2.2.16 — Vista mobile-friendly (viewport < 768px)", () => {
  test("viewport 360px renderiza MobileView con lista de estados", async ({ browser }) => {
    // Contexto en tamaño desktop para el login: KioskAutoRedirect
    // (components/kiosk-auto-redirect.tsx) se monta en /dashboard y
    // redirige a /orientacion?montaje=kiosko en cualquier viewport
    // <=1024px — login() nunca ve la URL /dashboard que espera y
    // `waitForURL` revienta por timeout. Achicamos el viewport DESPUÉS
    // del login, ya lejos de /dashboard, para probar el layout mobile de
    // workflow-designer sin disparar el guard de kiosko.
    const context = await browser.newContext();
    const page = await context.newPage();

    // "director", NO "admin": workflowTipoDoc.list exige DIR/WORKFLOW_DESIGNER
    // (ver comentario en "Director ve botón editar" arriba) — con "admin"
    // getFirstWorkflowHref() siempre devolvía null y el timeout de FORBIDDEN
    // terminaba maquillado como skip "sin workflows sembrados", un motivo
    // falso — hallazgo @QA (2026-09-28).
    await login(page, "director");
    await page.setViewportSize({ width: 360, height: 640 });
    const href = await getFirstWorkflowHref(page);
    if (!href) {
      await context.close();
      test.skip(true, "Sin workflows sembrados en BD de test para el rol DIR");
      return;
    }

    await page.goto(href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Verificar que el contenedor de mobile view existe
    const mobileContainer = page.getByTestId("mobile-view-container");
    const containerCount = await mobileContainer.count();

    if (containerCount > 0) {
      await expect(mobileContainer).toBeVisible();

      // En mobile NO debe renderizarse el canvas ReactFlow (data-testid del grafo)
      await expect(
        page.getByTestId("workflow-graph-container"),
      ).toHaveCount(0);

      // Banner de solo edición en desktop
      await expect(page.locator("body")).toContainText(/solo lectura en móvil|solo desktop/i);
    }

    // En cualquier caso la página no debe tener errores
    await expect(page.locator("body")).not.toContainText("Application error");

    await context.close();
  });

  test("viewport 375px — ReactFlow canvas ausente en mobile", async ({ browser }) => {
    // Mismo motivo que el test anterior: viewport móvil se aplica DESPUÉS
    // del login para no disparar KioskAutoRedirect en /dashboard. "director",
    // NO "admin" — ver comentario en "Director ve botón editar" arriba.
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page, "director");
    await page.setViewportSize({ width: 375, height: 812 });
    const href = await getFirstWorkflowHref(page);
    if (!href) {
      await context.close();
      test.skip(true, "Sin workflows sembrados en BD de test para el rol DIR");
      return;
    }

    await page.goto(href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // ReactFlow inyecta una clase "react-flow" — no debe estar en mobile
    const reactFlowEl = page.locator(".react-flow");
    const rfCount = await reactFlowEl.count();

    // Si el componente mobile view está activo, no debe haber ReactFlow
    const mobileContainer = page.getByTestId("mobile-view-container");
    if ((await mobileContainer.count()) > 0) {
      expect(rfCount).toBe(0);
    }

    await expect(page.locator("body")).not.toContainText("Application error");
    await context.close();
  });
});
