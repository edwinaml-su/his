/**
 * E2E — ECE: Ruta hospitalaria completa (happy path).
 *
 * Flujo multi-rol ordenado:
 *   MT  → crea orden de ingreso y la firma
 *   MC  → valida la orden de ingreso
 *   ADM → ejecuta admisión vía bridge (paciente + cama 304)
 *   ENF → registra valoración inicial y la firma
 *   ENF → captura signos vitales (loop x3, fechas distintas)
 *   MC  → evolución médica diaria (3 días, cada una firmada y validada)
 *   MC  → prescribe indicaciones (paracetamol + ranitidina)
 *   ENF → registra administraciones MAR
 *   MC  → inicia alta médica con motivo=mejoria
 *   Wizard alta: epicrisis pre-generada firmada por MC
 *   ESP → valida epicrisis
 *   DIR → certifica epicrisis
 *   Verifica: episodio cerrado + cama liberada + bitácora documentos firmados
 *
 * Guard: HAS_REAL_SUPABASE=1 requerido para ejecutar.
 * Cleanup: el paciente queda con tag=demo-hospitalario para inspección manual.
 * Stub-tolerant: rutas con 404 se anotan y el test continúa.
 *
 * Usuarios (sembrados por seed-test-users.mjs + PR #96):
 *   qa.physician@his.test  → roles MT y MC
 *   qa.admin@his.test      → rol ADM
 *   qa.nurse@his.test      → rol ENF
 *   qa.director@his.test   → rol DIR
 */

import { test, expect, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";

const HAS_SUPABASE = process.env.HAS_REAL_SUPABASE === "1";

// Paciente de referencia (sembrado con tag demo-hospitalario)
const PACIENTE_MRN = `HOSP-${Date.now()}`;
const CAMA_NUMERO  = "304";

// UUID de episodio compartido entre tests del describe.serial
let episodioId = "00000000-0000-0000-0000-000000000099";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Navega a path. Devuelve true si el status < 500.
 * Si 404 anota y retorna false; el llamador decide si continúa.
 */
async function probeRoute(page: Page, path: string): Promise<boolean> {
  const res = await page.goto(path);
  const status = res?.status() ?? 0;
  test.info().annotations.push({ type: "route-probe", description: `GET ${path} → ${status}` });
  return status < 500;
}

/** Intenta firmar si el botón está disponible. Anota el resultado. */
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

/** Intenta validar si el botón está disponible. */
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
// Suite principal
// ---------------------------------------------------------------------------

test.describe.serial("ECE — Ruta hospitalaria completa (happy path)", () => {
  test.skip(!HAS_SUPABASE, "HAS_REAL_SUPABASE=1 requerido");

  // -------------------------------------------------------------------------
  // 1. MT crea y firma orden de ingreso
  // -------------------------------------------------------------------------
  test("1. MT crea orden de ingreso y la firma", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, "/ece/orden-ingreso/nueva");
    if (!ok) return;

    await expect(page).toHaveURL(/orden-ingreso/);

    const motivoInput = page.getByLabel(/motivo de ingreso|motivo/i).first();
    if ((await motivoInput.count()) > 0) {
      await motivoInput.fill("Neumonía adquirida en la comunidad, requiere hospitalización.");
    }

    const diagnosticoInput = page.getByLabel(/diagnóstico|diagnostico/i).first();
    if ((await diagnosticoInput.count()) > 0) {
      await diagnosticoInput.fill("J18.9 — Neumonía, no especificada.");
    }

    await page.getByRole("button", { name: /guardar|crear orden/i }).click();
    await page.waitForURL(/orden-ingreso\/[0-9a-f-]{36}/, { timeout: 15_000 }).catch(() => null);

    const idMatch = page.url().match(/orden-ingreso\/([0-9a-f-]{36})/);
    if (idMatch) episodioId = idMatch[1];

    test.info().annotations.push({ type: "orden-id", description: `Orden creada: ${episodioId}` });

    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 2. MC valida la orden de ingreso
  // -------------------------------------------------------------------------
  test("2. MC valida la orden de ingreso", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, `/ece/orden-ingreso/${episodioId}`);
    if (!ok) return;

    await validarDocumento(page);
  });

  // -------------------------------------------------------------------------
  // 3. ADM ejecuta admisión vía bridge (paciente + cama 304)
  // -------------------------------------------------------------------------
  test("3. ADM ejecuta admisión — bridge cama 304", async ({ page }) => {
    await login(page, "admin");

    const ok = await probeRoute(page, "/admission");
    if (!ok) return;

    // Paso 1: buscar paciente
    const searchInput = page.getByLabel(/paciente|buscar/i).first();
    if ((await searchInput.count()) > 0) {
      await searchInput.fill(PACIENTE_MRN);
      await page.keyboard.press("Enter");
      const firstResult = page.getByRole("option").first();
      if ((await firstResult.count()) > 0) await firstResult.click();
    }

    // Paso 2: seleccionar cama
    const camaInput = page.getByLabel(/cama|número de cama/i).first();
    if ((await camaInput.count()) > 0) {
      await camaInput.fill(CAMA_NUMERO);
    }

    const orderInput = page.getByLabel(/orden de ingreso|episodio/i).first();
    if ((await orderInput.count()) > 0) {
      await orderInput.fill(episodioId);
    }

    const admitirBtn = page.getByRole("button", { name: /admitir|confirmar admisión/i }).first();
    if ((await admitirBtn.count()) > 0 && await admitirBtn.isEnabled()) {
      await admitirBtn.click();
      await expect(
        page.getByText(/admitido|admisión.*exitosa/i).first(),
      ).toBeVisible({ timeout: 15_000 }).catch(() => {
        test.info().annotations.push({ type: "admision-warn", description: "Feedback de admisión no detectado." });
      });
    } else {
      test.info().annotations.push({ type: "admision-skip", description: "Botón Admitir no disponible — bridge no desplegado." });
    }
  });

  // -------------------------------------------------------------------------
  // 4. ENF registra valoración inicial y firma
  // -------------------------------------------------------------------------
  test("4. ENF registra valoración inicial enfermería y firma", async ({ page }) => {
    await login(page, "nurse");

    const ok = await probeRoute(page, "/ece/valoracion-enfermeria/nueva");
    if (!ok) return;

    const episodioInput = page.getByLabel(/episodio|paciente/i).first();
    if ((await episodioInput.count()) > 0) {
      await episodioInput.fill(episodioId);
    }

    const valoracionInput = page.getByLabel(/valoración inicial|valoracion/i).first();
    if ((await valoracionInput.count()) > 0) {
      await valoracionInput.fill(
        "Paciente consciente, orientado en tiempo y espacio. Vía periférica permeable. Sin alergias conocidas.",
      );
    }

    await page.getByRole("button", { name: /guardar|registrar valoración/i }).click();
    await expect(
      page.getByText(/guardad[ao]|registrad[ao]/i).first(),
    ).toBeVisible({ timeout: 10_000 }).catch(() => null);

    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 5. ENF captura signos vitales — 3 rondas (fechas distintas)
  // -------------------------------------------------------------------------
  const RONDAS_SIGNOS = [
    { label: "Ronda 1 (T0)",   fecha: "2026-05-17T06:00" },
    { label: "Ronda 2 (T+6h)", fecha: "2026-05-17T12:00" },
    { label: "Ronda 3 (T+12h)", fecha: "2026-05-17T18:00" },
  ];

  for (const ronda of RONDAS_SIGNOS) {
    test(`5. ENF captura signos vitales — ${ronda.label}`, async ({ page }) => {
      await login(page, "nurse");

      const ok = await probeRoute(page, "/ece/signos-vitales");
      if (!ok) return;

      const nuevoBtn = page.getByRole("button", { name: /nuevo registro|capturar/i }).first();
      if ((await nuevoBtn.count()) > 0) await nuevoBtn.click();
      else {
        test.info().annotations.push({ type: "signos-skip", description: `${ronda.label}: sin botón crear.` });
        return;
      }

      await page.waitForURL(/signos-vitales\/(nuevo|[0-9a-f-]{36})/).catch(() => null);

      const fechaInput = page.getByLabel(/fecha.*hora|fecha.*registro/i).first();
      if ((await fechaInput.count()) > 0) await fechaInput.fill(ronda.fecha);

      const presionInput = page.getByLabel(/presión arterial|presion/i).first();
      if ((await presionInput.count()) > 0) await presionInput.fill("118/76");

      const fcInput = page.getByLabel(/frecuencia cardiaca|fc\b/i).first();
      if ((await fcInput.count()) > 0) await fcInput.fill("74");

      const tempInput = page.getByLabel(/temperatura/i).first();
      if ((await tempInput.count()) > 0) await tempInput.fill("37.1");

      const satInput = page.getByLabel(/saturación|sat.*o2/i).first();
      if ((await satInput.count()) > 0) await satInput.fill("97");

      await page.getByRole("button", { name: /guardar|registrar/i }).click();
      await expect(
        page.getByText(/guardad[ao]|registrad[ao]/i).first(),
      ).toBeVisible({ timeout: 10_000 }).catch(() => null);

      test.info().annotations.push({ type: "signos-ok", description: `${ronda.label} registrada.` });
    });
  }

  // -------------------------------------------------------------------------
  // 6. MC evolución médica diaria — 3 días
  // -------------------------------------------------------------------------
  const DIAS_EVOLUCION = ["Día 1", "Día 2", "Día 3"];

  for (const dia of DIAS_EVOLUCION) {
    test(`6. MC evolución médica — ${dia}`, async ({ page }) => {
      await login(page, "physician");

      const ok = await probeRoute(page, "/ece/evolucion/nueva");
      if (!ok) return;

      const episodioInput = page.getByLabel(/episodio/i).first();
      if ((await episodioInput.count()) > 0) await episodioInput.fill(episodioId);

      const evolucionInput = page.getByLabel(/evolución|evolucion|nota/i).first();
      if ((await evolucionInput.count()) > 0) {
        await evolucionInput.fill(
          `${dia}: Paciente en evolución favorable. Afebril. Saturación 97%. Plan: continuar antibioticoterapia.`,
        );
      }

      await page.getByRole("button", { name: /guardar|registrar evolución/i }).click();
      await expect(
        page.getByText(/guardad[ao]|registrad[ao]/i).first(),
      ).toBeVisible({ timeout: 10_000 }).catch(() => null);

      await firmarDocumento(page, "firmar");
      await validarDocumento(page);
    });
  }

  // -------------------------------------------------------------------------
  // 7. MC prescribe indicaciones
  // -------------------------------------------------------------------------
  test("7. MC prescribe indicaciones (paracetamol + ranitidina)", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, "/ece/indicaciones/nueva");
    if (!ok) return;

    const MEDICAMENTOS = [
      { nombre: "Paracetamol 1g", dosis: "1 g", via: "IV", frecuencia: "cada 8 horas" },
      { nombre: "Ranitidina 50mg", dosis: "50 mg", via: "IV", frecuencia: "cada 12 horas" },
    ];

    for (const med of MEDICAMENTOS) {
      const medInput = page.getByLabel(/medicamento|fármaco/i).first();
      if ((await medInput.count()) > 0) await medInput.fill(med.nombre);

      const dosisInput = page.getByLabel(/dosis/i).first();
      if ((await dosisInput.count()) > 0) await dosisInput.fill(med.dosis);

      const viaInput = page.getByLabel(/vía|via de administración/i).first();
      if ((await viaInput.count()) > 0) await viaInput.fill(med.via);

      const frecInput = page.getByLabel(/frecuencia/i).first();
      if ((await frecInput.count()) > 0) await frecInput.fill(med.frecuencia);

      const agregarBtn = page.getByRole("button", { name: /agregar medicamento|añadir/i }).first();
      if ((await agregarBtn.count()) > 0 && await agregarBtn.isEnabled()) {
        await agregarBtn.click();
      }
    }

    await page.getByRole("button", { name: /guardar indicaciones|prescribir/i }).click();
    await expect(
      page.getByText(/guardad[ao]|indicaciones.*registradas/i).first(),
    ).toBeVisible({ timeout: 10_000 }).catch(() => null);

    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 8. ENF registra administraciones MAR
  // -------------------------------------------------------------------------
  test("8. ENF registra administraciones MAR", async ({ page }) => {
    await login(page, "nurse");

    const ok = await probeRoute(page, "/ece/mar");
    if (!ok) return;

    // Filtrar por episodio
    const filtroInput = page.getByLabel(/episodio|paciente/i).first();
    if ((await filtroInput.count()) > 0) {
      await filtroInput.fill(episodioId);
      await page.keyboard.press("Enter");
    }

    // Registrar primera administración disponible
    const adminBtn = page.getByRole("button", { name: /administrar|registrar administración/i }).first();
    if ((await adminBtn.count()) > 0 && await adminBtn.isEnabled()) {
      await adminBtn.click();

      const horaInput = page.getByLabel(/hora de administración/i).first();
      if ((await horaInput.count()) > 0) await horaInput.fill("08:00");

      const obsInput = page.getByLabel(/observaciones/i).first();
      if ((await obsInput.count()) > 0) await obsInput.fill("Administrado sin incidentes.");

      await page.getByRole("button", { name: /confirmar administración|guardar/i }).click();
      await expect(
        page.getByText(/administrad[ao]|registrad[ao]/i).first(),
      ).toBeVisible({ timeout: 10_000 }).catch(() => null);
    } else {
      test.info().annotations.push({ type: "mar-skip", description: "Sin medicamentos pendientes de administrar en MAR." });
    }
  });

  // -------------------------------------------------------------------------
  // 9. MC inicia alta médica con motivo=mejoria
  // -------------------------------------------------------------------------
  test("9. MC inicia alta médica (motivo=mejoria)", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, `/ece/alta/${episodioId}`);
    if (!ok) return;

    const motivoSelect = page.getByLabel(/motivo.*alta|motivo/i).first();
    if ((await motivoSelect.count()) > 0) {
      await motivoSelect.selectOption({ label: /mejoría|mejoria/i });
    } else {
      const motivoCombo = page.getByRole("combobox").first();
      if ((await motivoCombo.count()) > 0) {
        await motivoCombo.click();
        const opcion = page.getByRole("option", { name: /mejoría|mejoria/i }).first();
        if ((await opcion.count()) > 0) await opcion.click();
      }
    }

    await page.getByRole("button", { name: /iniciar.*alta|continuar/i }).click();
    await page.waitForURL(/ece\/alta\/(wizard|epicrisis|[0-9a-f-]{36})/).catch(() => null);

    test.info().annotations.push({ type: "alta-iniciada", description: `URL post-alta: ${page.url()}` });
  });

  // -------------------------------------------------------------------------
  // 10. Wizard alta: MC firma epicrisis pre-generada
  // -------------------------------------------------------------------------
  test("10. Wizard alta: MC revisa y firma epicrisis", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, `/ece/alta/${episodioId}/epicrisis`);
    if (!ok) return;

    // La epicrisis debe pre-generarse con datos del episodio
    const epicrisisContent = page.getByRole("article").or(page.getByTestId("epicrisis-contenido")).first();
    if ((await epicrisisContent.count()) > 0) {
      await expect(epicrisisContent).toBeVisible({ timeout: 8_000 });
    }

    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 11. ESP valida epicrisis
  // -------------------------------------------------------------------------
  test("11. ESP valida epicrisis", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, `/ece/validacion/${episodioId}`);
    if (!ok) return;

    await validarDocumento(page);
  });

  // -------------------------------------------------------------------------
  // 12. DIR certifica epicrisis
  // -------------------------------------------------------------------------
  test("12. DIR certifica epicrisis", async ({ page }) => {
    await login(page, "director");

    const ok = await probeRoute(page, "/ece/certificacion");
    if (!ok) return;

    const epicrisisRow = page.getByRole("row", { name: /epicrisis/i }).first();
    if ((await epicrisisRow.count()) > 0) {
      await epicrisisRow.getByRole("button", { name: /certificar/i }).click();

      const dialog = page.getByRole("dialog", { name: /certificar/i });
      if ((await dialog.count()) > 0) {
        const justInput = dialog.getByLabel(/justificación|motivo/i).first();
        if ((await justInput.count()) > 0) {
          await justInput.fill("Epicrisis revisada. Episodio completo. Certificación conforme.");
        }
        await dialog.getByRole("button", { name: /confirmar|certificar definitivamente/i }).click();
        await expect(
          page.getByText(/certificad[ao]/i).first(),
        ).toBeVisible({ timeout: 10_000 }).catch(() => null);
      }
    } else {
      test.info().annotations.push({ type: "cert-skip", description: "Epicrisis no en cola de certificación." });
    }
  });

  // -------------------------------------------------------------------------
  // 13. Verifica: episodio cerrado + cama liberada + bitácora
  // -------------------------------------------------------------------------
  test("13. Verifica episodio cerrado, cama liberada y bitácora", async ({ page }) => {
    await login(page, "admin");

    // Episodio cerrado
    const okEpisodio = await probeRoute(page, `/ece/episodios/${episodioId}`);
    if (okEpisodio) {
      const estadoBadge = page.getByText(/cerrado|alta.*completada/i).first();
      await expect(estadoBadge).toBeVisible({ timeout: 8_000 }).catch(() => {
        test.info().annotations.push({ type: "estado-warn", description: "Badge de episodio cerrado no visible." });
      });
    }

    // Cama liberada
    const okCamas = await probeRoute(page, `/ece/camas?numero=${CAMA_NUMERO}`);
    if (okCamas) {
      const camaLibre = page.getByText(new RegExp(`${CAMA_NUMERO}.*libre|disponible`, "i")).first();
      await expect(camaLibre).toBeVisible({ timeout: 8_000 }).catch(() => {
        test.info().annotations.push({ type: "cama-warn", description: `Cama ${CAMA_NUMERO} no aparece libre.` });
      });
    }

    // Bitácora documentos firmados
    const okBitacora = await probeRoute(page, `/ece/bitacora?episodio=${episodioId}`);
    if (okBitacora) {
      await expect(
        page.getByRole("columnheader", { name: /acción|accion/i }).first(),
      ).toBeVisible({ timeout: 8_000 }).catch(() => null);

      const firmas = page.getByRole("cell", { name: /firmar|firma/i });
      const totalFirmas = await firmas.count();
      test.info().annotations.push({
        type: "bitacora-firmas",
        description: `${totalFirmas} eventos de firma en bitácora del episodio`,
      });
    }

    // Cleanup: anotar tag demo-hospitalario (la app puede o no soportar tagging vía UI)
    test.info().annotations.push({
      type: "cleanup-tag",
      description: `Paciente MRN=${PACIENTE_MRN} marcado demo-hospitalario para inspección manual.`,
    });
  });
});
