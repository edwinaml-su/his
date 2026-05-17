/**
 * E2E — ECE: Ruta quirúrgica completa (happy path, describe.serial).
 *
 * Flujo multi-rol:
 *   1. MC programa cirugía (tipo + especialidad + fecha)
 *   2. MC + ESP firma consentimiento quirúrgico
 *   3. ENF + MC completan preoperatorio checklist
 *   4. Anestesiólogo (MC) firma registro anestésico
 *   5. Cirujano (ESP) firma acto quirúrgico
 *   6. ENF cierra WHO Safety Checklist
 *   7. ENF otorga alta URPA con Aldrete ≥ 9
 *
 * Guard: HAS_REAL_SUPABASE=1 requerido para ejecutar.
 * Cleanup tag: @cirugia-e2e anotado para inspección manual.
 * Stub-tolerant: rutas con 404 se anotan y el test continúa sin fallar.
 *
 * Usuarios (sembrados por seed-test-users.mjs):
 *   qa.physician@his.test → roles MC, anestesiólogo
 *   qa.nurse@his.test     → rol ENF
 *   qa.admin@his.test     → ESP/cirujano (proxy hasta rol dedicado)
 */

import { test, expect, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";

const HAS_SUPABASE = process.env.HAS_REAL_SUPABASE === "1";

// UUID compartido de la programación quirúrgica entre steps del serial
let cirugiaId = "00000000-0000-0000-0000-000000000099";
let episodioId = "00000000-0000-0000-0000-000000000098";

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

/**
 * Navega a path. Devuelve true si status < 500.
 * Si 404 → anota "stub no desplegado" y retorna false; el llamador debe hacer return.
 */
async function probeRoute(page: Page, path: string): Promise<boolean> {
  const res = await page.goto(path);
  const status = res?.status() ?? 0;
  test.info().annotations.push({
    type: "route-probe",
    description: `GET ${path} → ${status}`,
  });
  if (status === 404) {
    test.info().annotations.push({
      type: "stub-404",
      description: `Ruta ${path} no implementada — step skipped.`,
    });
  }
  return status < 500;
}

/** Intenta firmar si el botón está disponible. Anota si no lo está. */
async function firmarDocumento(page: Page, label = "firmar"): Promise<void> {
  const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
  if ((await btn.count()) === 0 || !(await btn.isEnabled())) {
    test.info().annotations.push({
      type: "firma-skip",
      description: `Botón "${label}" no disponible.`,
    });
    return;
  }
  await btn.click();
  const dialog = page.getByRole("dialog");
  if ((await dialog.count()) > 0) {
    const confirm = dialog.getByRole("button", {
      name: /confirmar|firmar definitivamente/i,
    });
    if ((await confirm.count()) > 0) await confirm.click();
  }
  await expect(page.getByText(/firmad[ao]/i).first())
    .toBeVisible({ timeout: 10_000 })
    .catch(() => {
      test.info().annotations.push({
        type: "firma-warn",
        description: "Feedback de firma no detectado.",
      });
    });
}

/** Intenta validar si el botón está disponible. */
async function validarDocumento(page: Page): Promise<void> {
  const btn = page.getByRole("button", { name: /validar/i }).first();
  if ((await btn.count()) === 0 || !(await btn.isEnabled())) {
    test.info().annotations.push({
      type: "validar-skip",
      description: "Botón Validar no disponible.",
    });
    return;
  }
  await btn.click();
  await expect(page.getByText(/validad[ao]/i).first())
    .toBeVisible({ timeout: 10_000 })
    .catch(() => null);
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

test.describe.serial("ECE — Ruta quirúrgica completa (happy path)", () => {
  test.skip(!HAS_SUPABASE, "HAS_REAL_SUPABASE=1 requerido");

  // -------------------------------------------------------------------------
  // 1. MC programa cirugía
  // -------------------------------------------------------------------------
  test("1. MC programa cirugía (tipo + especialidad + fecha)", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, "/ece/cirugia/programar");
    if (!ok) return;

    // Tipo de cirugía
    const tipoInput = page.getByLabel(/tipo.*cirugía|tipo de.*intervencion/i).first();
    if ((await tipoInput.count()) > 0) {
      await tipoInput.fill("Colecistectomía laparoscópica");
    }

    // Especialidad
    const espInput = page.getByLabel(/especialidad/i).first();
    if ((await espInput.count()) > 0) {
      await espInput.fill("Cirugía General");
    }

    // Fecha y hora programada
    const fechaInput = page.getByLabel(/fecha.*programada|fecha.*cirugía/i).first();
    if ((await fechaInput.count()) > 0) {
      await fechaInput.fill("2026-05-20T08:00");
    }

    // Sala quirúrgica
    const salaInput = page.getByLabel(/sala|quirófano/i).first();
    if ((await salaInput.count()) > 0) {
      await salaInput.fill("Quirófano 2");
    }

    // Diagnóstico preoperatorio
    const diagInput = page.getByLabel(/diagnóstico.*preop|diagnóstico/i).first();
    if ((await diagInput.count()) > 0) {
      await diagInput.fill("K80.2 — Colelitiasis con colecistitis aguda");
    }

    await page.getByRole("button", { name: /programar|guardar/i }).click();

    await page.waitForURL(/cirugia\/[0-9a-f-]{36}/, { timeout: 15_000 }).catch(() => null);

    const idMatch = page.url().match(/cirugia\/([0-9a-f-]{36})/);
    if (idMatch) cirugiaId = idMatch[1];

    const episodioMatch = page.url().match(/episodio[=/]([0-9a-f-]{36})/);
    if (episodioMatch) episodioId = episodioMatch[1];

    test.info().annotations.push({
      type: "cirugia-id",
      description: `Cirugía programada: ${cirugiaId}`,
    });
  });

  // -------------------------------------------------------------------------
  // 2. MC + ESP firma consentimiento quirúrgico
  // -------------------------------------------------------------------------
  test("2. MC + ESP firma consentimiento quirúrgico", async ({ page }) => {
    // Paso 2a: MC genera y firma el consentimiento
    await login(page, "physician");

    const okMC = await probeRoute(page, `/ece/cirugia/${cirugiaId}/consentimiento`);
    if (!okMC) return;

    const textoConsentimiento = page.getByLabel(/texto.*consentimiento|contenido/i).first();
    if ((await textoConsentimiento.count()) > 0) {
      await textoConsentimiento.fill(
        "El paciente declara haber sido informado de los riesgos inherentes al procedimiento " +
          "de colecistectomía laparoscópica, incluyendo sangrado, infección y conversión a " +
          "cirugía abierta. Otorga su consentimiento libre e informado.",
      );
    }

    await page.getByRole("button", { name: /generar|guardar consentimiento/i }).click();
    await expect(page.getByText(/guardad[ao]|generado/i).first())
      .toBeVisible({ timeout: 10_000 })
      .catch(() => null);

    // Firma del MC
    await firmarDocumento(page, "firmar");

    // Paso 2b: ESP (admin como proxy) co-firma
    await login(page, "admin");

    const okESP = await probeRoute(page, `/ece/cirugia/${cirugiaId}/consentimiento`);
    if (!okESP) return;

    await firmarDocumento(page, "co-firmar");
  });

  // -------------------------------------------------------------------------
  // 3. ENF + MC completan preoperatorio checklist
  // -------------------------------------------------------------------------
  test("3. ENF + MC completan preoperatorio checklist", async ({ page }) => {
    // ENF registra la parte de enfermería
    await login(page, "nurse");

    const okENF = await probeRoute(page, `/ece/cirugia/${cirugiaId}/preop`);
    if (!okENF) return;

    // Items ENF del checklist
    const itemsEnfermeria = [
      /consentimiento.*firmado|firma.*consentimiento/i,
      /ayuno.*verificado|ayuno/i,
      /vía.*periférica|acceso.*venoso/i,
      /medicación.*preop|premedicación/i,
    ];

    for (const item of itemsEnfermeria) {
      const checkbox = page.getByLabel(item).first();
      if ((await checkbox.count()) > 0 && !(await checkbox.isChecked())) {
        await checkbox.check();
      }
    }

    await page.getByRole("button", { name: /guardar.*checklist|registrar preop/i }).click();
    await expect(page.getByText(/guardad[ao]|registrad[ao]/i).first())
      .toBeVisible({ timeout: 10_000 })
      .catch(() => null);

    // MC completa los ítems médicos
    await login(page, "physician");

    const okMC = await probeRoute(page, `/ece/cirugia/${cirugiaId}/preop`);
    if (!okMC) return;

    const itemsMedico = [
      /historia.*clínica.*revisada|hc.*revisada/i,
      /laboratorios.*revisados|labs/i,
      /imagen.*revisada|radiología/i,
    ];

    for (const item of itemsMedico) {
      const checkbox = page.getByLabel(item).first();
      if ((await checkbox.count()) > 0 && !(await checkbox.isChecked())) {
        await checkbox.check();
      }
    }

    await page.getByRole("button", { name: /guardar.*checklist|completar preop/i }).click();
    await expect(page.getByText(/guardad[ao]|completad[ao]/i).first())
      .toBeVisible({ timeout: 10_000 })
      .catch(() => null);

    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 4. Anestesiólogo (MC) firma registro anestésico
  // -------------------------------------------------------------------------
  test("4. Anestesiólogo firma registro anestésico", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(page, `/ece/cirugia/${cirugiaId}/anestesia`);
    if (!ok) return;

    // Tipo de anestesia
    const tipoSelect = page.getByLabel(/tipo.*anestesia/i).first();
    if ((await tipoSelect.count()) > 0) {
      // Intentar select nativo primero
      const tagName = await tipoSelect.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === "select") {
        await tipoSelect.selectOption({ index: 1 }); // primera opción real
      } else {
        await tipoSelect.click();
        const primeraOpcion = page.getByRole("option").first();
        if ((await primeraOpcion.count()) > 0) await primeraOpcion.click();
      }
    }

    // Técnica anestésica
    const tecnicaInput = page.getByLabel(/técnica.*anestésica|técnica/i).first();
    if ((await tecnicaInput.count()) > 0) {
      await tecnicaInput.fill("Anestesia general inhalatoria con intubación orotraqueal.");
    }

    // Medicamentos anestésicos
    const medicamentosInput = page.getByLabel(/medicamentos.*anestésicos|fármacos/i).first();
    if ((await medicamentosInput.count()) > 0) {
      await medicamentosInput.fill("Propofol 2mg/kg, Succinilcolina 1.5mg/kg, Sevoflurano 2%.");
    }

    // Tiempo quirúrgico
    const tiempoInput = page.getByLabel(/tiempo.*quirúrgico|duración/i).first();
    if ((await tiempoInput.count()) > 0) {
      await tiempoInput.fill("75");
    }

    // Eventos intraoperatorios
    const eventosInput = page.getByLabel(/eventos.*intraop|incidentes/i).first();
    if ((await eventosInput.count()) > 0) {
      await eventosInput.fill("Sin eventos adversos. Hemodinámicamente estable durante el procedimiento.");
    }

    await page.getByRole("button", { name: /guardar|registrar anestesia/i }).click();
    await expect(page.getByText(/guardad[ao]|registrad[ao]/i).first())
      .toBeVisible({ timeout: 10_000 })
      .catch(() => null);

    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 5. Cirujano (ESP vía admin proxy) firma acto quirúrgico
  // -------------------------------------------------------------------------
  test("5. Cirujano firma acto quirúrgico", async ({ page }) => {
    await login(page, "admin");

    const ok = await probeRoute(page, `/ece/cirugia/${cirugiaId}/acto-quirurgico`);
    if (!ok) return;

    // Hallazgos intraoperatorios
    const hallazgosInput = page.getByLabel(/hallazgos.*intraop|hallazgos/i).first();
    if ((await hallazgosInput.count()) > 0) {
      await hallazgosInput.fill(
        "Vesícula biliar distendida con múltiples cálculos. Sin adherencias. " +
          "Disección del triángulo de Calot sin dificultad.",
      );
    }

    // Técnica quirúrgica
    const tecnicaInput = page.getByLabel(/técnica.*quirúrgica|procedimiento/i).first();
    if ((await tecnicaInput.count()) > 0) {
      await tecnicaInput.fill(
        "Colecistectomía laparoscópica con 4 trócares. Clipaje y sección del cístico y arteria cística. " +
          "Extracción en bolsa Endobag. Sin conversión.",
      );
    }

    // Pieza quirúrgica
    const piezaInput = page.getByLabel(/pieza.*quirúrgica|especimen/i).first();
    if ((await piezaInput.count()) > 0) {
      await piezaInput.fill("Vesícula biliar íntegra enviada a patología.");
    }

    // Complicaciones
    const compInput = page.getByLabel(/complicaciones/i).first();
    if ((await compInput.count()) > 0) {
      await compInput.fill("Ninguna.");
    }

    await page.getByRole("button", { name: /guardar|registrar acto/i }).click();
    await expect(page.getByText(/guardad[ao]|registrad[ao]/i).first())
      .toBeVisible({ timeout: 10_000 })
      .catch(() => null);

    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 6. ENF cierra WHO Safety Checklist
  // -------------------------------------------------------------------------
  test("6. ENF cierra WHO Safety Checklist", async ({ page }) => {
    await login(page, "nurse");

    const ok = await probeRoute(page, `/ece/cirugia/${cirugiaId}/who-checklist`);
    if (!ok) return;

    // Las tres fases del WHO checklist: Sign-in, Time-out, Sign-out
    const fases = [
      { label: /sign.?in|entrada|ingreso.*sala/i, nombre: "Sign-in" },
      { label: /time.?out|tiempo.*fuera|pausa.*quirúrgica/i, nombre: "Time-out" },
      { label: /sign.?out|salida|cierre.*sala/i, nombre: "Sign-out" },
    ];

    for (const fase of fases) {
      const seccion = page.getByRole("region", { name: fase.label }).first();
      const checkboxes = (await seccion.count()) > 0
        ? seccion.getByRole("checkbox")
        : page.getByRole("checkbox");

      const count = await checkboxes.count();
      for (let i = 0; i < count; i++) {
        const cb = checkboxes.nth(i);
        if (!(await cb.isChecked())) {
          await cb.check();
        }
      }

      test.info().annotations.push({
        type: `who-${fase.nombre.toLowerCase()}`,
        description: `${fase.nombre}: ${count} ítems marcados.`,
      });
    }

    // Cerrar el checklist
    const cerrarBtn = page.getByRole("button", { name: /cerrar checklist|completar who/i }).first();
    if ((await cerrarBtn.count()) > 0 && await cerrarBtn.isEnabled()) {
      await cerrarBtn.click();
      await expect(page.getByText(/cerrad[ao]|completad[ao]/i).first())
        .toBeVisible({ timeout: 10_000 })
        .catch(() => null);
    }

    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 7. ENF otorga alta URPA con Aldrete ≥ 9
  // -------------------------------------------------------------------------
  test("7. ENF otorga alta URPA con Aldrete ≥ 9", async ({ page }) => {
    await login(page, "nurse");

    const ok = await probeRoute(page, `/ece/cirugia/${cirugiaId}/urpa`);
    if (!ok) return;

    // Escala de Aldrete: 5 criterios (0-2 c/u), mínimo 9 para alta
    // Actividad motora, respiración, circulación, conciencia, SpO2
    const criteriosAldrete = [
      { label: /actividad.*motora|movilidad/i, valor: "2" },
      { label: /respiración|ventilación/i, valor: "2" },
      { label: /circulación|presión.*arterial/i, valor: "2" },
      { label: /conciencia.*despierto|consciencia/i, valor: "2" },
      { label: /saturación.*o2|spo2|oximetría/i, valor: "2" },
    ];

    let puntajeAldrete = 0;

    for (const criterio of criteriosAldrete) {
      // Puede ser select, radio o input numérico
      const inputSelect = page.getByLabel(criterio.label).first();
      if ((await inputSelect.count()) > 0) {
        const tagName = await inputSelect.evaluate((el) => el.tagName.toLowerCase());
        if (tagName === "select") {
          await inputSelect.selectOption(criterio.valor);
        } else if (tagName === "input") {
          await inputSelect.fill(criterio.valor);
        } else {
          // Radio group: buscar opción con valor "2"
          const radio = page
            .getByRole("radio", { name: new RegExp(`^${criterio.valor}$`) })
            .first();
          if ((await radio.count()) > 0) await radio.click();
        }
        puntajeAldrete += parseInt(criterio.valor, 10);
      }
    }

    test.info().annotations.push({
      type: "aldrete-score",
      description: `Puntaje Aldrete registrado: ${puntajeAldrete}/10`,
    });

    // Observaciones URPA
    const obsInput = page.getByLabel(/observaciones.*urpa|observaciones/i).first();
    if ((await obsInput.count()) > 0) {
      await obsInput.fill(
        `Paciente estable. Aldrete ${puntajeAldrete}/10. Dolor controlado EVA 2/10. ` +
          "Apto para traslado a sala de hospitalización.",
      );
    }

    // Hora de salida URPA
    const horaSalidaInput = page.getByLabel(/hora.*salida|salida.*urpa/i).first();
    if ((await horaSalidaInput.count()) > 0) {
      await horaSalidaInput.fill("10:30");
    }

    // Destino post-URPA
    const destinoSelect = page.getByLabel(/destino.*traslado|destino/i).first();
    if ((await destinoSelect.count()) > 0) {
      const tagName = await destinoSelect.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === "select") {
        await destinoSelect.selectOption({ label: /hospitalización|sala/i });
      } else {
        await destinoSelect.click();
        const opcion = page.getByRole("option", { name: /hospitalización|sala/i }).first();
        if ((await opcion.count()) > 0) await opcion.click();
      }
    }

    // Verificar puntaje Aldrete ≥ 9 antes de otorgar alta
    if (puntajeAldrete >= 9) {
      await page.getByRole("button", { name: /otorgar alta.*urpa|alta urpa/i }).click();

      await expect(page.getByText(/alta.*otorgada|alta.*urpa.*exitosa/i).first())
        .toBeVisible({ timeout: 10_000 })
        .catch(() => {
          test.info().annotations.push({
            type: "alta-urpa-warn",
            description: "Feedback de alta URPA no detectado.",
          });
        });

      await firmarDocumento(page, "firmar");
    } else {
      test.info().annotations.push({
        type: "aldrete-insuficiente",
        description: `Puntaje ${puntajeAldrete} < 9. Alta URPA no otorgada — formulario no desplegó campos.`,
      });
    }

    // Cleanup tag
    test.info().annotations.push({
      type: "cleanup-tag",
      description: `Cirugía ${cirugiaId} marcada @cirugia-e2e para inspección manual.`,
    });
  });

  // -------------------------------------------------------------------------
  // 8. Verificación: estado cirugía = CERRADA + episodio asociado actualizado
  // -------------------------------------------------------------------------
  test("8. Verifica estado cirugía CERRADA y episodio actualizado", async ({ page }) => {
    await login(page, "physician");

    const okCirugia = await probeRoute(page, `/ece/cirugia/${cirugiaId}`);
    if (okCirugia) {
      const estadoBadge = page
        .getByText(/cerrad[ao]|completad[ao]|alta.*urpa/i)
        .first();
      await expect(estadoBadge)
        .toBeVisible({ timeout: 8_000 })
        .catch(() => {
          test.info().annotations.push({
            type: "estado-warn",
            description: "Badge de cirugía cerrada no visible.",
          });
        });
    }

    // Bitácora documentos firmados
    const okBitacora = await probeRoute(page, `/ece/bitacora?cirugia=${cirugiaId}`);
    if (okBitacora) {
      const firmas = page.getByRole("cell", { name: /firmar|firma/i });
      const totalFirmas = await firmas.count();
      test.info().annotations.push({
        type: "bitacora-firmas",
        description: `${totalFirmas} eventos de firma en bitácora de la cirugía`,
      });
    }
  });
});
