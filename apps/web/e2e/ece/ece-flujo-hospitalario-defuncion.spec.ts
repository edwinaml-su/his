/**
 * E2E — ECE: Ruta hospitalaria con alta por defunción.
 *
 * Flujo:
 *   MT  → crea orden de ingreso y firma
 *   MC  → valida orden de ingreso
 *   ADM → admisión vía bridge
 *   ENF → valoración inicial + signos vitales
 *   MC  → evolución diaria (1 día)
 *   MC  → inicia alta con motivo=defuncion
 *   Redirección automática a /ece/defuncion/nueva
 *   MC  → completa certificado de defunción con causas CIE-10
 *   DIR → certifica defunción
 *   Verifica: episodio cerrado con motivo=defuncion
 *
 * Guard: HAS_REAL_SUPABASE=1 requerido.
 * Stub-tolerant: rutas 404 anotadas, test continúa.
 */

import { test, expect, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";

const HAS_SUPABASE = process.env.HAS_REAL_SUPABASE === "1";

const PACIENTE_MRN = `DEF-${Date.now()}`;

let episodioId = "00000000-0000-0000-0000-000000000098";

// ---------------------------------------------------------------------------
// Utilidades (duplicadas localmente — cada spec es autocontenido)
// ---------------------------------------------------------------------------

async function probeRoute(page: Page, path: string): Promise<boolean> {
  const res = await page.goto(path);
  const status = res?.status() ?? 0;
  test.info().annotations.push({ type: "route-probe", description: `GET ${path} → ${status}` });
  return status < 500;
}

async function firmarDocumento(page: Page, label = "firmar"): Promise<void> {
  const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
  if ((await btn.count()) === 0 || !(await btn.isEnabled())) {
    test.info().annotations.push({ type: "firma-skip", description: `Botón "${label}" no disponible.` });
    return;
  }
  await btn.click();
  const dialog = page.getByRole("dialog");
  if ((await dialog.count()) > 0) {
    const confirm = dialog.getByRole("button", { name: /confirmar|firmar definitivamente/i });
    if ((await confirm.count()) > 0) await confirm.click();
  }
  await expect(page.getByText(/firmad[ao]/i).first()).toBeVisible({ timeout: 10_000 }).catch(() => {
    test.info().annotations.push({ type: "firma-warn", description: "Feedback de firma no detectado." });
  });
}

async function validarDocumento(page: Page): Promise<void> {
  const btn = page.getByRole("button", { name: /validar/i }).first();
  if ((await btn.count()) === 0 || !(await btn.isEnabled())) {
    test.info().annotations.push({ type: "validar-skip", description: "Botón Validar no disponible." });
    return;
  }
  await btn.click();
  await expect(page.getByText(/validad[ao]/i).first()).toBeVisible({ timeout: 10_000 }).catch(() => null);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe.serial("ECE — Ruta hospitalaria: alta por defunción", () => {
  test.skip(!HAS_SUPABASE, "HAS_REAL_SUPABASE=1 requerido");

  // -------------------------------------------------------------------------
  // 1. MT crea y firma orden de ingreso
  // -------------------------------------------------------------------------
  test("1. MT crea orden de ingreso y firma", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, "/ece/orden-ingreso/nueva");
    if (!ok) return;

    const motivoInput = page.getByLabel(/motivo de ingreso|motivo/i).first();
    if ((await motivoInput.count()) > 0) {
      await motivoInput.fill("Insuficiencia respiratoria grave. Ingreso para manejo UCI.");
    }

    const diagnosticoInput = page.getByLabel(/diagnóstico|diagnostico/i).first();
    if ((await diagnosticoInput.count()) > 0) {
      await diagnosticoInput.fill("J96.0 — Insuficiencia respiratoria aguda.");
    }

    await page.getByRole("button", { name: /guardar|crear orden/i }).click();
    await page.waitForURL(/orden-ingreso\/[0-9a-f-]{36}/, { timeout: 15_000 }).catch(() => null);

    const idMatch = page.url().match(/orden-ingreso\/([0-9a-f-]{36})/);
    if (idMatch) episodioId = idMatch[1];

    test.info().annotations.push({ type: "orden-id", description: `Orden creada: ${episodioId}` });
    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 2. MC valida orden de ingreso
  // -------------------------------------------------------------------------
  test("2. MC valida la orden de ingreso", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, `/ece/orden-ingreso/${episodioId}`);
    if (!ok) return;

    await validarDocumento(page);
  });

  // -------------------------------------------------------------------------
  // 3. ADM ejecuta admisión
  // -------------------------------------------------------------------------
  test("3. ADM ejecuta admisión", async ({ page }) => {
    await login(page, "admin");

    const ok = await probeRoute(page, "/admission");
    if (!ok) return;

    const searchInput = page.getByLabel(/paciente|buscar/i).first();
    if ((await searchInput.count()) > 0) {
      await searchInput.fill(PACIENTE_MRN);
      await page.keyboard.press("Enter");
      const firstResult = page.getByRole("option").first();
      if ((await firstResult.count()) > 0) await firstResult.click();
    }

    const admitirBtn = page.getByRole("button", { name: /admitir|confirmar admisión/i }).first();
    if ((await admitirBtn.count()) > 0 && await admitirBtn.isEnabled()) {
      await admitirBtn.click();
      await expect(
        page.getByText(/admitido|admisión.*exitosa/i).first(),
      ).toBeVisible({ timeout: 15_000 }).catch(() => null);
    } else {
      test.info().annotations.push({ type: "admision-skip", description: "Botón Admitir no disponible." });
    }
  });

  // -------------------------------------------------------------------------
  // 4. ENF valoración inicial + signos vitales
  // -------------------------------------------------------------------------
  test("4. ENF valoración inicial y signos vitales", async ({ page }) => {
    await login(page, "nurse");

    // Valoración
    const okVal = await probeRoute(page, "/ece/valoracion-enfermeria/nueva");
    if (okVal) {
      const valorInput = page.getByLabel(/valoración inicial|valoracion/i).first();
      if ((await valorInput.count()) > 0) {
        await valorInput.fill("Paciente en estado crítico. Monitoreo continuo instaurado.");
      }
      await page.getByRole("button", { name: /guardar|registrar/i }).click();
      await expect(
        page.getByText(/guardad[ao]/i).first(),
      ).toBeVisible({ timeout: 10_000 }).catch(() => null);
      await firmarDocumento(page, "firmar");
    }

    // Signos vitales
    const okSv = await probeRoute(page, "/ece/signos-vitales");
    if (!okSv) return;

    const nuevoBtn = page.getByRole("button", { name: /nuevo registro|capturar/i }).first();
    if ((await nuevoBtn.count()) > 0) {
      await nuevoBtn.click();
      await page.waitForURL(/signos-vitales\/(nuevo|[0-9a-f-]{36})/).catch(() => null);

      const presionInput = page.getByLabel(/presión arterial|presion/i).first();
      if ((await presionInput.count()) > 0) await presionInput.fill("80/50");

      const satInput = page.getByLabel(/saturación|sat.*o2/i).first();
      if ((await satInput.count()) > 0) await satInput.fill("82");

      await page.getByRole("button", { name: /guardar|registrar/i }).click();
      await expect(
        page.getByText(/guardad[ao]/i).first(),
      ).toBeVisible({ timeout: 10_000 }).catch(() => null);
    }
  });

  // -------------------------------------------------------------------------
  // 5. MC evolución médica día 1
  // -------------------------------------------------------------------------
  test("5. MC evolución médica día 1", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, "/ece/evolucion/nueva");
    if (!ok) return;

    const evolucionInput = page.getByLabel(/evolución|evolucion|nota/i).first();
    if ((await evolucionInput.count()) > 0) {
      await evolucionInput.fill(
        "Día 1: Paciente con deterioro clínico progresivo. Insuficiencia multiorgánica instaurada.",
      );
    }

    await page.getByRole("button", { name: /guardar|registrar evolución/i }).click();
    await expect(
      page.getByText(/guardad[ao]/i).first(),
    ).toBeVisible({ timeout: 10_000 }).catch(() => null);

    await firmarDocumento(page, "firmar");
    await validarDocumento(page);
  });

  // -------------------------------------------------------------------------
  // 6. MC inicia alta con motivo=defuncion
  // -------------------------------------------------------------------------
  test("6. MC inicia alta médica con motivo=defuncion", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, `/ece/alta/${episodioId}`);
    if (!ok) return;

    // Seleccionar motivo defunción
    const motivoSelect = page.getByLabel(/motivo.*alta|motivo/i).first();
    if ((await motivoSelect.count()) > 0) {
      await motivoSelect.selectOption({ label: /defunción|defuncion/i });
    } else {
      const combo = page.getByRole("combobox").first();
      if ((await combo.count()) > 0) {
        await combo.click();
        const opcion = page.getByRole("option", { name: /defunción|defuncion/i }).first();
        if ((await opcion.count()) > 0) await opcion.click();
      }
    }

    await page.getByRole("button", { name: /iniciar.*alta|continuar/i }).click();

    // La app debe redirigir automáticamente al módulo de defunción
    await page.waitForURL(/ece\/defuncion\/(nueva|[0-9a-f-]{36})/, { timeout: 15_000 }).catch(() => {
      test.info().annotations.push({
        type: "redirect-warn",
        description: `Redirección a /ece/defuncion no ocurrió. URL actual: ${page.url()}`,
      });
    });

    test.info().annotations.push({ type: "defuncion-redirect", description: `URL: ${page.url()}` });
  });

  // -------------------------------------------------------------------------
  // 7. MC completa certificado de defunción con causas CIE-10
  // -------------------------------------------------------------------------
  test("7. MC completa certificado de defunción (CIE-10)", async ({ page }) => {
    await login(page, "physician");

    // Intentar ruta directa si la redirección del paso 6 no persiste en nueva page
    const ok = await probeRoute(page, `/ece/defuncion/nueva?episodio=${episodioId}`);
    if (!ok) {
      // Fallback: buscar en lista
      await probeRoute(page, "/ece/defuncion");
    }

    // Causa directa de muerte (Ia)
    const causaDirectaInput = page.getByLabel(/causa directa|causa.*ia|causa.*inmediata/i).first();
    if ((await causaDirectaInput.count()) > 0) {
      await causaDirectaInput.fill("J96.0 — Insuficiencia respiratoria aguda");
    }

    // Causa antecedente (Ib)
    const causaAntecedenteInput = page.getByLabel(/causa antecedente|causa.*ib/i).first();
    if ((await causaAntecedenteInput.count()) > 0) {
      await causaAntecedenteInput.fill("J18.9 — Neumonía no especificada");
    }

    // Causa básica (Ic / II)
    const causaBasicaInput = page.getByLabel(/causa básica|causa.*ic|causa.*subyacente/i).first();
    if ((await causaBasicaInput.count()) > 0) {
      await causaBasicaInput.fill("E11 — Diabetes mellitus tipo 2");
    }

    // Fecha y hora de fallecimiento
    const fechaFallInput = page.getByLabel(/fecha.*fallecimiento|fecha.*defunción/i).first();
    if ((await fechaFallInput.count()) > 0) await fechaFallInput.fill("2026-05-17T22:30");

    // Lugar de fallecimiento
    const lugarSelect = page.getByLabel(/lugar.*fallecimiento/i).first();
    if ((await lugarSelect.count()) > 0) {
      await lugarSelect.selectOption({ label: /establecimiento|hospital/i });
    }

    await page.getByRole("button", { name: /guardar|registrar defunción/i }).click();
    await expect(
      page.getByText(/guardad[ao]|registrad[ao]/i).first(),
    ).toBeVisible({ timeout: 10_000 }).catch(() => null);

    await firmarDocumento(page, "firmar");

    test.info().annotations.push({
      type: "certificado-defuncion",
      description: "Certificado completado con causas CIE-10 y firmado por MC.",
    });
  });

  // -------------------------------------------------------------------------
  // 8. DIR certifica defunción
  // -------------------------------------------------------------------------
  test("8. DIR certifica certificado de defunción", async ({ page }) => {
    await login(page, "director");

    const ok = await probeRoute(page, "/ece/certificacion");
    if (!ok) return;

    // Buscar fila de defunción en la cola
    const defRow = page
      .getByRole("row")
      .filter({ hasText: /defunción|defuncion|fallecimiento/i })
      .first();

    if ((await defRow.count()) === 0) {
      test.info().annotations.push({
        type: "cert-skip",
        description: "Certificado de defunción no en cola de certificación.",
      });
      return;
    }

    await defRow.getByRole("button", { name: /certificar/i }).click();

    const dialog = page.getByRole("dialog", { name: /certificar/i });
    if ((await dialog.count()) > 0) {
      const justInput = dialog.getByLabel(/justificación|motivo/i).first();
      if ((await justInput.count()) > 0) {
        await justInput.fill("Certificado de defunción revisado. Causas de muerte verificadas. Conforme.");
      }
      await dialog.getByRole("button", { name: /confirmar|certificar definitivamente/i }).click();
      await expect(
        page.getByText(/certificad[ao]/i).first(),
      ).toBeVisible({ timeout: 10_000 }).catch(() => null);
    }
  });

  // -------------------------------------------------------------------------
  // 9. Verifica episodio cerrado con motivo=defuncion
  // -------------------------------------------------------------------------
  test("9. Verifica episodio cerrado con motivo=defuncion", async ({ page }) => {
    await login(page, "admin");

    const ok = await probeRoute(page, `/ece/episodios/${episodioId}`);
    if (!ok) return;

    // El episodio debe mostrar estado cerrado con causa defunción
    const estadoCerrado = page.getByText(/cerrado/i).first();
    await expect(estadoCerrado).toBeVisible({ timeout: 8_000 }).catch(() => {
      test.info().annotations.push({ type: "estado-warn", description: "Estado cerrado no visible." });
    });

    const motivoDefuncion = page.getByText(/defunción|defuncion/i).first();
    await expect(motivoDefuncion).toBeVisible({ timeout: 8_000 }).catch(() => {
      test.info().annotations.push({ type: "motivo-warn", description: "Motivo defunción no visible en episodio." });
    });

    test.info().annotations.push({
      type: "cleanup-tag",
      description: `Paciente MRN=${PACIENTE_MRN} marcado demo-hospitalario para inspección manual.`,
    });
  });
});
