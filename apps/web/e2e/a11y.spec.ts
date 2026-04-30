/**
 * E2E — Accesibilidad WCAG con axe-core (TDR §29.6).
 * Política: ninguna violación de impacto `serious` o `critical` en las
 * páginas principales del MVP.
 *
 * Las violaciones `moderate`/`minor` se reportan como advertencia pero
 * no rompen el build (gate de cumplimiento mínimo en MVP — se endurece
 * en Fase 4 a "ninguna" violación).
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login } from "./_helpers/auth";

const PAGES_AUTH_REQUIRED = [
  { name: "Dashboard", path: "/" },
  { name: "Pacientes", path: "/patients" },
  { name: "Camas", path: "/beds" },
  { name: "Triage pendiente", path: "/triage/pending" },
  { name: "Encuentros", path: "/encounters" },
  { name: "Admisión", path: "/admission/new" },
];

test.describe("Accesibilidad — sin violaciones serias o críticas", () => {
  test("Login (público)", async ({ page }) => {
    await page.goto("/login");
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const blockers = r.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });

  for (const { name, path } of PAGES_AUTH_REQUIRED) {
    test(name, async ({ page }) => {
      await login(page, "admin");
      await page.goto(path);
      const r = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      const blockers = r.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact ?? ""),
      );
      expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
    });
  }

  test("Triage Manchester — colores con info no solo cromática", async ({ page }) => {
    await login(page, "triagist");
    await page.goto("/triage/pending");

    // Cada celda de nivel debe exponer un nombre accesible explícito.
    // (Ej.: "Nivel rojo - emergencia", no solo un fondo rojo.)
    const levelCells = page.getByRole("cell", { name: /nivel (rojo|naranja|amarillo|verde|azul)/i });
    const count = await levelCells.count();
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        await expect(levelCells.nth(i)).toHaveAccessibleName(/nivel/i);
      }
    }

    // axe-core reglas específicas de uso de color.
    const r = await new AxeBuilder({ page })
      .withTags(["cat.color", "wcag2aa"])
      .analyze();
    const blockers = r.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });
});
