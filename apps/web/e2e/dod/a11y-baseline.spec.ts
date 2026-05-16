/**
 * DoD.0 — Baseline de accesibilidad (axe-core WCAG 2.1 AA)
 *
 * Propósito: obtener la primera evidencia verificable de violaciones a11y
 * en las 5 páginas clave del sistema. Bloquea solo si hay violaciones
 * `critical` o `serious`. Las `minor`/`moderate` se reportan sin fallar.
 *
 * Ejecución:
 *   npx playwright test e2e/dod/a11y-baseline.spec.ts --headed
 *
 * No ejecutar en CI hasta que el dev server esté disponible
 * (ver e2e.yml — solo nightly o manual).
 *
 * @author @QA — Wave DoD.0 — 2026-05-16
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login } from "../_helpers/auth";

/** Páginas a auditar con sus rutas y rol requerido */
const PAGES: Array<{ name: string; path: string; role?: "admin" | "triagist" | "nurse" }> = [
  { name: "Inicio (público)", path: "/", role: undefined },
  { name: "Login", path: "/login", role: undefined },
  { name: "Admin dashboard", path: "/admin", role: "admin" },
  { name: "Notificaciones", path: "/notifications", role: "admin" },
  { name: "Configuración notificaciones", path: "/settings/notifications", role: "admin" },
];

/** Severidades que bloquean el build (DoD §3). */
const BLOCKING_IMPACTS = ["critical", "serious"] as const;

test.describe("DoD.0 — Baseline A11y (WCAG 2.1 AA)", () => {
  for (const { name, path, role } of PAGES) {
    test(`${name} — sin violaciones críticas/serias`, async ({ page }) => {
      // Navegar (con login si aplica)
      if (role) {
        await login(page, role);
      }
      await page.goto(path, { waitUntil: "domcontentloaded" });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();

      // Separar violaciones por severidad para logging claro
      const blockers = results.violations.filter((v) =>
        BLOCKING_IMPACTS.includes(v.impact as (typeof BLOCKING_IMPACTS)[number]),
      );
      const warnings = results.violations.filter(
        (v) => !BLOCKING_IMPACTS.includes(v.impact as (typeof BLOCKING_IMPACTS)[number]),
      );

      // Reportar warnings sin fallar
      if (warnings.length > 0) {
        console.warn(
          `[A11Y WARNING] ${name}: ${warnings.length} violación(es) minor/moderate — ` +
            warnings.map((v) => `${v.id}(${v.impact})`).join(", "),
        );
      }

      // Resumen por página
      console.info(
        `[A11Y] ${name}: ${results.violations.length} total, ` +
          `${blockers.length} bloqueantes, ${warnings.length} warnings`,
      );

      // Falla solo si hay violaciones críticas o serias
      expect(
        blockers,
        `Página "${name}" tiene ${blockers.length} violación(es) críticas/serias:\n` +
          JSON.stringify(
            blockers.map((v) => ({
              id: v.id,
              impact: v.impact,
              description: v.description,
              nodes: v.nodes.length,
            })),
            null,
            2,
          ),
      ).toEqual([]);
    });
  }
});
