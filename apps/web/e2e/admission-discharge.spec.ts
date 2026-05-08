/**
 * E2E — Admisión, traslado interno y alta.
 * US: ADM-01 (admisión), ADM-02 (traslado), ADM-03 (alta médica).
 *
 * Estructura real de la app (Sprint 3):
 *   - /admission (wizard 4 pasos: Paciente → Datos → Cama → Confirmar)
 *     → on submit → /admission/[id]/confirm con encounterNumber visible.
 *   - /transfers (tablero + form inline "Nuevo traslado").
 *   - /encounters/[id]/discharge (wizard 2 pasos: Tipo+Diagnóstico → Epicrisis).
 *
 * Asunciones del seed (packages/database/scripts/seed-e2e-fixtures.mjs):
 *   - Paciente "María Pérez" existe (MRN E2E-MARIA-PEREZ-01).
 *   - Existe encuentro abierto del día (ENC-number tipo E2E-YYYYMMDD-001).
 *   - Idempotencia: encounter.admit retorna el abierto si ya existe.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

test.describe("Admisión → Traslado → Alta", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, "admin");
  });

  test("admisión: wizard de 4 pasos crea encuentro y redirige a /admission/[id]/confirm", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto("/admission", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await expect(page.getByRole("heading", { name: /admisión/i })).toBeVisible();

    // --- Paso 1: Paciente ---
    // PatientSearchBar expone aria-label="Búsqueda de pacientes".
    await page.getByLabel(/búsqueda de pacientes/i).fill("María");
    await page.waitForTimeout(1500);
    // Resultado renderizado como <button> dentro de <li>.
    await page.getByRole("button", { name: /María\s+Pérez/i }).first().click();
    await page.getByRole("button", { name: /^continuar$/i }).click();

    // --- Paso 2: Datos ---
    await page.waitForTimeout(800);
    // Tipo de admisión por defecto es "Emergencia" (EMERGENCY) — no requiere cambio.
    // Servicio: shadcn Select expuesto como combobox.
    const serviceCombo = page.getByRole("combobox").nth(1);
    await serviceCombo.click();
    await page.getByRole("option").first().click();
    // La moneda se auto-elige en useEffect (primera de la lista).
    // Motivo de consulta opcional.
    await page.getByLabel(/motivo de consulta/i).fill("Dolor torácico — E2E");
    await page.getByRole("button", { name: /^continuar$/i }).click();

    // --- Paso 3: Cama (opcional para EMERGENCY) ---
    await page.waitForTimeout(1500);
    // EMERGENCY permite "Continuar sin cama".
    const sinCama = page.getByRole("button", { name: /continuar sin cama/i });
    if (await sinCama.isVisible().catch(() => false)) {
      await sinCama.click();
    } else {
      await page.getByRole("button", { name: /^continuar$/i }).click();
    }

    // --- Paso 4: Confirmar ---
    await page.waitForTimeout(800);
    await expect(page.getByRole("heading", { name: /confirmar/i })).toBeVisible();
    await page.getByRole("button", { name: /confirmar admisión/i }).click();

    // Tras admit.useMutation onSuccess → router.replace(`/admission/${id}/confirm`).
    await page.waitForURL(/\/admission\/[^/]+\/confirm/, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    // El número de encuentro real puede ser ENC-YYYY-XXXXXX o E2E-YYYYMMDD-NNN
    // (el seed usa E2E-...). Validamos sólo que aparece "Encuentro <algo>".
    await expect(page.getByText(/encuentro\s+[A-Z0-9-]+/i)).toBeVisible();
    await expect(page.getByText(/admisión confirmada/i)).toBeVisible();
  });

  test("traslado interno: /transfers + form 'Nuevo traslado' registra movimiento", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto("/transfers", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await expect(
      page.getByRole("heading", { name: /traslados internos/i }),
    ).toBeVisible();

    // Abrir form inline.
    await page.getByRole("button", { name: /nuevo traslado/i }).click();
    await page.waitForTimeout(800);

    // Buscar encuentro abierto del seed.
    await page.getByLabel(/encuentro a trasladar/i).fill("María");
    await page.waitForTimeout(1500);
    // Lista de resultados son <button> dentro de <li>.
    await page
      .getByRole("button", { name: /María\s+Pérez/i })
      .first()
      .click();

    // Servicio destino: primer combobox del documento (el form inline
    // sólo expone 2 selects: servicio destino [0], cama destino [1]).
    const serviceCombo = page.getByRole("combobox").first();
    await serviceCombo.click();
    await page.getByRole("option").first().click();

    // Razón clínica obligatoria (>= 2 chars).
    await page.getByLabel(/razón clínica/i).fill("Cambio a UCI por deterioro clínico — E2E");

    await page.getByRole("button", { name: /confirmar traslado/i }).click();
    await page.waitForTimeout(1500);

    // Tras success el form se cierra y se invalida la lista.
    await expect(page.getByRole("button", { name: /nuevo traslado/i })).toBeVisible();
    // El traslado debe aparecer entre los recientes.
    await expect(
      page.getByText(/cambio a uci por deterioro clínico — e2e/i).first(),
    ).toBeVisible();
  });

  test("alta médica: /encounters/[id]/discharge wizard 2 pasos cierra encuentro", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Tomar un encuentro abierto desde la cola de triage (que lista openByOrg).
    await page.goto("/triage", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    // Click en "Evaluar" del primer encuentro abierto para obtener el id en URL.
    const evaluarLink = page.getByRole("link", { name: /evaluar/i }).first();
    await expect(evaluarLink).toBeVisible({ timeout: 10_000 });
    const href = await evaluarLink.getAttribute("href");
    // href: /triage/new/<encounterId>
    const encounterId = href?.split("/").pop() ?? "";
    expect(encounterId.length).toBeGreaterThan(8);

    // Navegar directo a /encounters/[id]/discharge.
    // BUG-UI-S5-DISCHARGE-CTA: encounter detail page NO expone botón
    // "Dar de alta". Propose data-testid: button on /encounters/[id]
    // que linkee a /encounters/[id]/discharge.
    await page.goto(`/encounters/${encounterId}/discharge`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1500);

    // Si el encounter ya está egresado, validamos el mensaje y salimos.
    const yaEgresado = await page
      .getByText(/encuentro ya egresado/i)
      .isVisible()
      .catch(() => false);
    if (yaEgresado) {
      test.info().annotations.push({
        type: "discharge-skip",
        description: "encuentro del seed ya cerrado — test idempotent ok",
      });
      return;
    }

    await expect(
      page.getByRole("heading", { name: /egreso del encuentro/i }),
    ).toBeVisible();

    // --- Paso 1: tipo + diagnóstico ---
    // Tipo de alta default = MEDICAL — no cambiamos.
    // Diagnóstico: usar inputs manuales (código + descripción).
    await page.getByLabel(/código cie-10/i).fill("I10");
    await page
      .getByLabel(/descripción del diagnóstico/i)
      .fill("Hipertensión esencial — E2E");
    await page.getByRole("button", { name: /continuar a epicrisis/i }).click();

    // --- Paso 2: epicrisis + confirmar ---
    await page.waitForTimeout(800);
    await expect(
      page.getByRole("heading", { name: /epicrisis/i }).first(),
    ).toBeVisible();

    // Confirmación destructiva: marcar checkbox de acknowledge antes del submit.
    await page
      .getByRole("checkbox", { name: /entiendo que esta acción no se puede deshacer/i })
      .check();
    await page.getByRole("button", { name: /confirmar egreso/i }).click();

    // Tras success → router.replace(`/encounters/[id]`).
    await page.waitForURL(/\/encounters\/[^/]+(?!\/discharge)/, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByText(/cerrado|egresado/i).first()).toBeVisible();
  });
});
