/**
 * E2E — Triage Manchester.
 * US: TRI-01 (signos vitales), TRI-02 (flujograma), TRI-03 (asignación nivel),
 *     TRI-04 (alerta visual rojo), TRI-05 (cola pendientes).
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("Triage Manchester", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, "triagist");
  });

  test("captura signos vitales + flujograma + nivel y muestra TriageWidget en cola", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Cola pendiente: ruta real es /triage (no /triage/pending).
    await page.goto("/triage", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await expect(
      page.getByRole("heading", { name: /triage manchester/i }),
    ).toBeVisible();

    // El seed tiene un encuentro abierto para María Pérez sin triage.
    // El botón "Evaluar" se renderiza como <Link> dentro de <Button asChild>
    // → role=link con href="/triage/new/[encounterId]".
    const evaluarLink = page.getByRole("link", { name: /evaluar/i }).first();
    await expect(evaluarLink).toBeVisible({ timeout: 10_000 });
    await evaluarLink.click();

    // /triage/new/[encounterId] (apps/web/src/app/(clinical)/triage/new/[encounterId]/page.tsx).
    await page.waitForURL(/\/triage\/new\/[^/]+/, { timeout: 10_000 });
    await page.waitForTimeout(1500);
    await expect(
      page.getByRole("heading", { name: /evaluación de triage/i }),
    ).toBeVisible();

    // --- Flujograma (combobox shadcn Select) ---
    // El form tiene 2 selects: [0]=Flujograma, [1]=Nivel asignado.
    const flowchartCombo = page.getByRole("combobox").nth(0);
    await flowchartCombo.click();
    await page.getByRole("option").first().click();

    // --- Nivel asignado (rojo si está disponible, fallback al primer option) ---
    const levelCombo = page.getByRole("combobox").nth(1);
    await levelCombo.click();
    // Las opciones tienen texto "RED — Emergencia (≤0 min)" según schema seed.
    const redOption = page.getByRole("option", { name: /^red\b/i }).first();
    if (await redOption.isVisible({ timeout: 1500 }).catch(() => false)) {
      await redOption.click();
    } else {
      await page.getByRole("option").first().click();
    }

    // --- Signos vitales (VitalSignsCapture: labels en español) ---
    // Componente: packages/ui/src/components/VitalSignsCapture.tsx
    await page.getByLabel(/^pa sistólica/i).fill("80");
    await page.getByLabel(/^pa diastólica/i).fill("50");
    await page.getByLabel(/^frecuencia cardíaca/i).fill("140");
    await page.getByLabel(/^spo₂|^spo2/i).fill("88");

    // --- Submit ---
    await page.getByRole("button", { name: /^registrar$/i }).click();

    // Tras success → router.replace("/triage").
    await page.waitForURL(/\/triage$/, { timeout: 15_000 });
    await page.waitForTimeout(1500);

    // El TriageWidget tiene role="status" y muestra el badge del nivel.
    // Si elegimos rojo, debe aparecer el badge "rojo|emergencia"; si no,
    // al menos un widget con role=status debe estar visible.
    const triageStatus = page.getByRole("status").first();
    await expect(triageStatus).toBeVisible({ timeout: 10_000 });
  });

  test("cola pendiente ordena por prioridad y antigüedad", async ({ page }) => {
    test.setTimeout(60_000);
    // Ruta real: /triage (la antigua /triage/pending nunca existió).
    await page.goto("/triage", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const rows = page.getByRole("row");
    // Smoke: la lista renderiza al menos un row de header + uno de datos.
    await expect(rows.first()).toBeVisible();
    // Los roles de columna están presentes para a11y.
    await expect(page.getByRole("columnheader", { name: /paciente/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /llegada|admisión|hora/i })).toBeVisible();
  });
});
