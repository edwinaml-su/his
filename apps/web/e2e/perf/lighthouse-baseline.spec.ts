/**
 * Performance Budget — Lighthouse Baseline (TDR §perf-budget)
 *
 * Umbrales mínimos alineados con HIS Production Runbook §perf-budget:
 *   Performance   ≥ 80
 *   Accessibility ≥ 95
 *   Best Practices≥ 90
 *   SEO           ≥ 85
 *
 * Guard: sólo corre si HAS_REAL_SUPABASE=true (BD real disponible).
 * En CI dummy (e2e.yml) se salta — requiere un entorno funcional completo.
 *
 * Cómo ejecutar manualmente:
 *   HAS_REAL_SUPABASE=true npx playwright test e2e/perf/lighthouse-baseline.spec.ts
 */
import fs from "fs";
import path from "path";
import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { playAudit } from "playwright-lighthouse";
import { login } from "../_helpers/auth";

// ---------------------------------------------------------------------------
// Guard — skip en entornos sin BD real
// ---------------------------------------------------------------------------
const HAS_REAL_SUPABASE = process.env.HAS_REAL_SUPABASE === "true";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  performance: 80,
  accessibility: 95,
  "best-practices": 90,
  seo: 85,
} as const;

// ---------------------------------------------------------------------------
// Páginas a auditar
// ---------------------------------------------------------------------------
const PAGES_TO_AUDIT: Array<{ name: string; path: string }> = [
  { name: "dashboard",           path: "/dashboard" },
  { name: "patients",            path: "/patients" },
  { name: "triage",              path: "/triage" },
  { name: "ece-historia-clinica",path: "/ece/historia-clinica" },
  { name: "workflow-designer",   path: "/workflow-designer" },
];

// ---------------------------------------------------------------------------
// Output dir para JSON reports
// ---------------------------------------------------------------------------
const REPORT_DIR = path.resolve(__dirname, "../../test-results/perf");

function ensureReportDir(): void {
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
test.describe("Lighthouse — Performance Budget", () => {
  // Skip entero si no hay BD real
  test.beforeAll(() => {
    if (!HAS_REAL_SUPABASE) {
      // eslint-disable-next-line no-console
      console.warn(
        "[perf] HAS_REAL_SUPABASE no está definido — saltando auditorías Lighthouse."
      );
    }
  });

  // Lighthouse necesita puerto CDP explícito; no usa el browser interno de Playwright.
  // Abrimos un browser nuevo con debugging-port para cada auditoría.
  const REMOTE_DEBUGGING_PORT = 9222;

  let context: BrowserContext;

  test.beforeEach(async () => {
    if (!HAS_REAL_SUPABASE) {
      test.skip();
      return;
    }
    // Contexto con CDP habilitado (requerido por lighthouse)
    const browser = await chromium.launch({
      args: [`--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`],
    });
    context = await browser.newContext();
  });

  test.afterEach(async () => {
    if (context) {
      await context.browser()?.close();
    }
  });

  for (const pageSpec of PAGES_TO_AUDIT) {
    test(`${pageSpec.name} cumple budget de performance`, async () => {
      ensureReportDir();

      const page = await context.newPage();

      // Autenticar sesión antes de auditar (páginas protegidas)
      await login(page);
      await page.goto(pageSpec.path, { waitUntil: "networkidle" });

      const reportPath = path.join(REPORT_DIR, `${pageSpec.name}.json`);

      const result = await playAudit({
        page,
        thresholds: THRESHOLDS,
        port: REMOTE_DEBUGGING_PORT,
        reports: {
          formats: { json: true },
          directory: REPORT_DIR,
          name: pageSpec.name,
        },
      });

      // Guardar snapshot de scores para histórico
      const scores = {
        page: pageSpec.name,
        url: `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}${pageSpec.path}`,
        timestamp: new Date().toISOString(),
        scores: {
          performance: Math.round(
            (result.lhr.categories["performance"]?.score ?? 0) * 100
          ),
          accessibility: Math.round(
            (result.lhr.categories["accessibility"]?.score ?? 0) * 100
          ),
          bestPractices: Math.round(
            (result.lhr.categories["best-practices"]?.score ?? 0) * 100
          ),
          seo: Math.round(
            (result.lhr.categories["seo"]?.score ?? 0) * 100
          ),
        },
      };

      fs.writeFileSync(
        path.join(REPORT_DIR, `${pageSpec.name}-scores.json`),
        JSON.stringify(scores, null, 2)
      );

      // Las aserciones de threshold las hace playAudit automáticamente;
      // aquí añadimos mensajes explícitos para el reporte.
      const { performance, accessibility, bestPractices, seo } = scores.scores;

      expect(
        performance,
        `[${pageSpec.name}] Performance ${performance} < umbral ${THRESHOLDS.performance}`
      ).toBeGreaterThanOrEqual(THRESHOLDS.performance);

      expect(
        accessibility,
        `[${pageSpec.name}] Accessibility ${accessibility} < umbral ${THRESHOLDS.accessibility}`
      ).toBeGreaterThanOrEqual(THRESHOLDS.accessibility);

      expect(
        bestPractices,
        `[${pageSpec.name}] Best Practices ${bestPractices} < umbral ${THRESHOLDS["best-practices"]}`
      ).toBeGreaterThanOrEqual(THRESHOLDS["best-practices"]);

      expect(
        seo,
        `[${pageSpec.name}] SEO ${seo} < umbral ${THRESHOLDS.seo}`
      ).toBeGreaterThanOrEqual(THRESHOLDS.seo);
    });
  }
});
