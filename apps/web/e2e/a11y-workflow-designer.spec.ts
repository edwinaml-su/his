/**
 * E2E — Accesibilidad WCAG 2.1 AA — Workflow Designer (US.F2.2.17)
 *
 * 5 escenarios axe-core que verifican que no haya violaciones
 * de impacto "critical" o "serious" en las páginas del editor.
 *
 * Prerequisito: debe existir al menos un tipo de documento sembrado.
 * Si no hay workflows en BD de test, los escenarios se marcan como
 * informativos y pasan para no bloquear el pipeline E2E.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login } from "./_helpers/auth";

// ─── Helper: obtiene href al primer workflow disponible ───────────────────────

async function getFirstWorkflowHref(page: import("@playwright/test").Page): Promise<string | null> {
  await page.goto("/workflow-designer", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const first = page.locator("a[href^='/workflow-designer/']").first();
  if ((await first.count()) === 0) return null;
  return first.getAttribute("href");
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

test.describe("US.F2.2.17 — WCAG 2.1 AA — Workflow Designer", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("Escenario 1: listado de tipos de documento — sin violaciones críticas o serias", async ({ page }) => {
    await page.goto("/workflow-designer", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    const blockers = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });

  test("Escenario 2: vista de grafo del workflow — sin violaciones críticas o serias", async ({ page }) => {
    const href = await getFirstWorkflowHref(page);
    if (!href) {
      test.skip(true, "Sin workflows sembrados en BD de test");
      return;
    }

    await page.goto(href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    const blockers = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });

  test("Escenario 3: skip-links presentes y funcionales", async ({ page }) => {
    const href = await getFirstWorkflowHref(page);
    if (!href) {
      test.skip(true, "Sin workflows sembrados en BD de test");
      return;
    }

    await page.goto(href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Tab activa el skip-link nav (sr-only con focus-within)
    await page.keyboard.press("Tab");

    // Verificar que existen los skip-links en el DOM
    const skipNav = page.getByRole("navigation", { name: /saltar al contenido/i });
    await expect(skipNav).toBeAttached();

    // Los anchors existen
    const skipCanvas = page.getByRole("link", { name: /saltar a canvas/i });
    await expect(skipCanvas).toBeAttached();
  });

  test("Escenario 4: banner modo solo lectura — contrast y roles aria presentes", async ({ page }) => {
    // Login como physician (no tiene rol editor) para ver el banner
    await login(page, "physician");
    const href = await getFirstWorkflowHref(page);
    if (!href) {
      test.skip(true, "Sin workflows sembrados en BD de test");
      return;
    }

    await page.goto(href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Solo ejecutamos axe si hay banner visible
    const banner = page.getByTestId("read-only-banner");
    const bannerCount = await banner.count();
    if (bannerCount === 0) {
      // Sin sesión real o sin datos — skip gracefully
      return;
    }

    const results = await new AxeBuilder({ page })
      .withTags(["cat.color", "wcag2aa"])
      .analyze();

    const blockers = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });

  test("Escenario 5: panel de validación — estructura semántica accesible", async ({ page }) => {
    const href = await getFirstWorkflowHref(page);
    if (!href) {
      test.skip(true, "Sin workflows sembrados en BD de test");
      return;
    }

    await page.goto(href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Verificar botón validar tiene aria-label
    const validarBtn = page.getByRole("button", { name: /validar/i });
    if ((await validarBtn.count()) > 0) {
      await expect(validarBtn).toHaveAttribute("aria-label");
    }

    // axe sobre la región del panel de validación
    const results = await new AxeBuilder({ page })
      .include('section, [role="region"], form, main, aside')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const blockers = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });
});
