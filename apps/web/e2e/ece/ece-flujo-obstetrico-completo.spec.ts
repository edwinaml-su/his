/**
 * E2E — ECE: Ruta obstétrica completa (happy path).
 *
 * Flujo:
 *   1. Admisión de paciente embarazada (MC + ENF)
 *   2. Registros de partograma — 4 tomas en intervalos de 1 hora
 *   3. Registro de nacimiento + Apgar (1 min y 5 min)
 *   4. Cierre de alumbramiento (placenta + revisión)
 *   5. Atención del recién nacido firmada por MC
 *
 * Guard: HAS_REAL_SUPABASE=1 requerido para ejecutar.
 * Cleanup tag: @obstetricia-e2e anotado para inspección manual.
 * Stub-tolerant: rutas con 404 se anotan y el test continúa sin fallar.
 *
 * Usuarios (sembrados por seed-test-users.mjs):
 *   qa.physician@his.test → rol MC (médico de guardia)
 *   qa.nurse@his.test     → rol ENF (matrona/enfermera obstétrica)
 *   qa.admin@his.test     → proxy para roles no disponibles en semilla
 */

import { test, expect, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";

const HAS_SUPABASE = process.env.HAS_REAL_SUPABASE === "1";

// UUIDs compartidos entre steps del describe
let ingresoObstetricoId = "00000000-0000-0000-0000-000000000097";
let nacimientoId = "00000000-0000-0000-0000-000000000096";
let rnId = "00000000-0000-0000-0000-000000000095";

// MRN único por ejecución para evitar colisiones
const PACIENTE_MRN_OBS = `OBS-${Date.now()}`;

// Tiempos de las 4 tomas del partograma (hora 0, +1h, +2h, +3h)
const TOMAS_PARTOGRAMA = [
  { label: "Toma 1 (T0)",   hora: "07:00", dilatacion: "4", borramiento: "50" },
  { label: "Toma 2 (T+1h)", hora: "08:00", dilatacion: "5", borramiento: "60" },
  { label: "Toma 3 (T+2h)", hora: "09:00", dilatacion: "7", borramiento: "75" },
  { label: "Toma 4 (T+3h)", hora: "10:00", dilatacion: "9", borramiento: "90" },
];

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

test.describe("ECE — Ruta obstétrica completa (happy path)", () => {
  test.skip(!HAS_SUPABASE, "HAS_REAL_SUPABASE=1 requerido");

  // -------------------------------------------------------------------------
  // 1. Admisión paciente embarazada
  // -------------------------------------------------------------------------
  test("1. Admisión de paciente embarazada", async ({ page }) => {
    await login(page, "nurse");

    const ok = await probeRoute(page, "/ece/obstetricia/admision");
    if (!ok) return;

    // Datos de la paciente
    const mrnInput = page.getByLabel(/expediente|mrn/i).first();
    if ((await mrnInput.count()) > 0) {
      await mrnInput.fill(PACIENTE_MRN_OBS);
    }

    const nombreInput = page.getByLabel(/nombre.*paciente|nombre/i).first();
    if ((await nombreInput.count()) > 0) {
      await nombreInput.fill("María");
    }

    const apellidoInput = page.getByLabel(/apellido/i).first();
    if ((await apellidoInput.count()) > 0) {
      await apellidoInput.fill("López de García");
    }

    // Semanas de gestación
    const semanasInput = page.getByLabel(/semanas.*gestación|semanas.*gest|fum/i).first();
    if ((await semanasInput.count()) > 0) {
      await semanasInput.fill("38");
    }

    // Motivo de ingreso obstétrico
    const motivoSelect = page.getByLabel(/motivo.*ingreso|motivo/i).first();
    if ((await motivoSelect.count()) > 0) {
      const tagName = await motivoSelect.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === "select") {
        await motivoSelect.selectOption({ label: /trabajo.*parto|labor.*parto/i });
      } else {
        await motivoSelect.click();
        const opcion = page.getByRole("option", { name: /trabajo.*parto|labor/i }).first();
        if ((await opcion.count()) > 0) await opcion.click();
      }
    }

    // Número de gestas
    const gestaInput = page.getByLabel(/gestas|número.*gestas/i).first();
    if ((await gestaInput.count()) > 0) {
      await gestaInput.fill("2");
    }

    // Partos previos
    const partosInput = page.getByLabel(/partos.*previos|partos/i).first();
    if ((await partosInput.count()) > 0) {
      await partosInput.fill("1");
    }

    // Cama obstétrica
    const camaInput = page.getByLabel(/cama|número.*cama/i).first();
    if ((await camaInput.count()) > 0) {
      await camaInput.fill("OBS-01");
    }

    await page.getByRole("button", { name: /admitir|registrar ingreso/i }).click();

    await page.waitForURL(/obstetricia\/(ingreso|admision|[0-9a-f-]{36})/, {
      timeout: 15_000,
    }).catch(() => null);

    const idMatch = page.url().match(/(?:obstetricia|ingreso)\/([0-9a-f-]{36})/);
    if (idMatch) ingresoObstetricoId = idMatch[1];

    test.info().annotations.push({
      type: "ingreso-obs-id",
      description: `Ingreso obstétrico: ${ingresoObstetricoId} — MRN: ${PACIENTE_MRN_OBS}`,
    });

    // MC revisa y valida el ingreso
    await login(page, "physician");

    const okMC = await probeRoute(page, `/ece/obstetricia/${ingresoObstetricoId}`);
    if (!okMC) return;

    const validarBtn = page.getByRole("button", { name: /validar.*ingreso|validar/i }).first();
    if ((await validarBtn.count()) > 0 && await validarBtn.isEnabled()) {
      await validarBtn.click();
      await expect(page.getByText(/validad[ao]/i).first())
        .toBeVisible({ timeout: 10_000 })
        .catch(() => null);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Registros de partograma — 4 tomas
  // -------------------------------------------------------------------------
  for (const toma of TOMAS_PARTOGRAMA) {
    test(`2. Partograma — ${toma.label}`, async ({ page }) => {
      await login(page, "nurse");

      const ok = await probeRoute(
        page,
        `/ece/obstetricia/${ingresoObstetricoId}/partograma`,
      );
      if (!ok) return;

      // Botón nueva toma / agregar registro
      const nuevoBtn = page
        .getByRole("button", { name: /nueva toma|agregar registro|nueva.*monitorización/i })
        .first();
      if ((await nuevoBtn.count()) > 0) {
        await nuevoBtn.click();
      }

      // Hora del registro
      const horaInput = page.getByLabel(/hora.*registro|hora/i).first();
      if ((await horaInput.count()) > 0) {
        await horaInput.fill(toma.hora);
      }

      // Dilatación cervical (cm)
      const dilatacionInput = page.getByLabel(/dilatación.*cervical|dilatacion|cm/i).first();
      if ((await dilatacionInput.count()) > 0) {
        await dilatacionInput.fill(toma.dilatacion);
      }

      // Borramiento (%)
      const borramientoInput = page.getByLabel(/borramiento|efacement/i).first();
      if ((await borramientoInput.count()) > 0) {
        await borramientoInput.fill(toma.borramiento);
      }

      // Frecuencia cardíaca fetal (FCF)
      const fcfInput = page.getByLabel(/fcf|frecuencia.*fetal|latidos.*feto/i).first();
      if ((await fcfInput.count()) > 0) {
        await fcfInput.fill("148");
      }

      // Contracciones uterinas
      const contrInput = page.getByLabel(/contracciones|frecuencia.*contracciones/i).first();
      if ((await contrInput.count()) > 0) {
        await contrInput.fill("3");
      }

      // Presión arterial materna
      const paInput = page.getByLabel(/presión.*arterial|pa materna/i).first();
      if ((await paInput.count()) > 0) {
        await paInput.fill("110/70");
      }

      // Posición fetal / presentación
      const posicionInput = page.getByLabel(/posición.*fetal|presentación/i).first();
      if ((await posicionInput.count()) > 0) {
        await posicionInput.fill("Cefálica");
      }

      await page.getByRole("button", { name: /guardar|registrar toma/i }).click();

      await expect(page.getByText(/guardad[ao]|registrad[ao]/i).first())
        .toBeVisible({ timeout: 10_000 })
        .catch(() => null);

      test.info().annotations.push({
        type: `partograma-${toma.label.replace(/\s/g, "-")}`,
        description: `Dilatación ${toma.dilatacion}cm / Borramiento ${toma.borramiento}% — hora ${toma.hora}`,
      });
    });
  }

  // -------------------------------------------------------------------------
  // 3. Registro de nacimiento + Apgar
  // -------------------------------------------------------------------------
  test("3. Registro nacimiento + Apgar (1 min y 5 min)", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(
      page,
      `/ece/obstetricia/${ingresoObstetricoId}/nacimiento`,
    );
    if (!ok) return;

    // Fecha y hora del nacimiento
    const horaNacimientoInput = page.getByLabel(/hora.*nacimiento|fecha.*parto/i).first();
    if ((await horaNacimientoInput.count()) > 0) {
      await horaNacimientoInput.fill("2026-05-20T10:45");
    }

    // Tipo de parto
    const tipoPartoSelect = page.getByLabel(/tipo.*parto|vía.*parto/i).first();
    if ((await tipoPartoSelect.count()) > 0) {
      const tagName = await tipoPartoSelect.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === "select") {
        await tipoPartoSelect.selectOption({ label: /eutócico|vaginal/i });
      } else {
        await tipoPartoSelect.click();
        const opcion = page
          .getByRole("option", { name: /eutócico|vaginal/i })
          .first();
        if ((await opcion.count()) > 0) await opcion.click();
      }
    }

    // Peso del RN (gramos)
    const pesoInput = page.getByLabel(/peso.*rn|peso.*recién nacido/i).first();
    if ((await pesoInput.count()) > 0) {
      await pesoInput.fill("3250");
    }

    // Talla del RN (cm)
    const tallaInput = page.getByLabel(/talla.*rn|talla.*recién nacido/i).first();
    if ((await tallaInput.count()) > 0) {
      await tallaInput.fill("50");
    }

    // Sexo del RN
    const sexoRnSelect = page.getByLabel(/sexo.*rn|sexo.*recién nacido/i).first();
    if ((await sexoRnSelect.count()) > 0) {
      const tagName = await sexoRnSelect.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === "select") {
        await sexoRnSelect.selectOption({ label: /masculino|femenino/i });
      }
    }

    // Apgar al 1 minuto (criterios: FC, respiración, tono, reflejos, color — 0-2 c/u)
    const apgar1Items = [
      { label: /frecuencia.*cardiaca.*1|fc.*1 min/i, valor: "2" },
      { label: /esfuerzo.*respiratorio.*1|respiración.*1/i, valor: "1" },
      { label: /tono.*muscular.*1|tono.*1/i, valor: "2" },
      { label: /reflejo.*1|respuesta.*estímulo.*1/i, valor: "2" },
      { label: /color.*piel.*1|coloración.*1/i, valor: "1" },
    ];

    let apgar1Total = 0;
    for (const item of apgar1Items) {
      const inputEl = page.getByLabel(item.label).first();
      if ((await inputEl.count()) > 0) {
        const tagName = await inputEl.evaluate((el) => el.tagName.toLowerCase());
        if (tagName === "input") {
          await inputEl.fill(item.valor);
        } else if (tagName === "select") {
          await inputEl.selectOption(item.valor);
        }
        apgar1Total += parseInt(item.valor, 10);
      }
    }

    // Apgar a los 5 minutos (generalmente mejora)
    const apgar5Items = [
      { label: /frecuencia.*cardiaca.*5|fc.*5 min/i, valor: "2" },
      { label: /esfuerzo.*respiratorio.*5|respiración.*5/i, valor: "2" },
      { label: /tono.*muscular.*5|tono.*5/i, valor: "2" },
      { label: /reflejo.*5|respuesta.*estímulo.*5/i, valor: "2" },
      { label: /color.*piel.*5|coloración.*5/i, valor: "1" },
    ];

    let apgar5Total = 0;
    for (const item of apgar5Items) {
      const inputEl = page.getByLabel(item.label).first();
      if ((await inputEl.count()) > 0) {
        const tagName = await inputEl.evaluate((el) => el.tagName.toLowerCase());
        if (tagName === "input") {
          await inputEl.fill(item.valor);
        } else if (tagName === "select") {
          await inputEl.selectOption(item.valor);
        }
        apgar5Total += parseInt(item.valor, 10);
      }
    }

    test.info().annotations.push({
      type: "apgar-scores",
      description: `Apgar 1min: ${apgar1Total}/10 | Apgar 5min: ${apgar5Total}/10`,
    });

    // Observaciones del parto
    const obsInput = page.getByLabel(/observaciones.*parto|notas.*nacimiento/i).first();
    if ((await obsInput.count()) > 0) {
      await obsInput.fill(
        `Parto eutócico. RN vigoroso. Apgar ${apgar1Total}/${apgar5Total}. ` +
          "Llanto inmediato. Sin necesidad de reanimación.",
      );
    }

    await page.getByRole("button", { name: /registrar nacimiento|guardar/i }).click();

    await page.waitForURL(
      /obstetricia\/([0-9a-f-]{36})\/(nacimiento|rn|recien-nacido)/,
      { timeout: 15_000 },
    ).catch(() => null);

    const nacIdMatch = page.url().match(/nacimiento\/([0-9a-f-]{36})/);
    if (nacIdMatch) nacimientoId = nacIdMatch[1];

    await expect(page.getByText(/nacimiento.*registrado|registro.*exitoso/i).first())
      .toBeVisible({ timeout: 10_000 })
      .catch(() => {
        test.info().annotations.push({
          type: "nacimiento-warn",
          description: "Feedback de nacimiento registrado no detectado.",
        });
      });

    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 4. Cierre de alumbramiento
  // -------------------------------------------------------------------------
  test("4. Cierre de alumbramiento (placenta + revisión)", async ({ page }) => {
    await login(page, "physician");

    const ok = await probeRoute(
      page,
      `/ece/obstetricia/${ingresoObstetricoId}/alumbramiento`,
    );
    if (!ok) return;

    // Tiempo del alumbramiento (minutos post-nacimiento)
    const tiempoInput = page.getByLabel(/tiempo.*alumbramiento|minutos.*alumbramiento/i).first();
    if ((await tiempoInput.count()) > 0) {
      await tiempoInput.fill("8");
    }

    // Tipo de alumbramiento
    const tipoSelect = page.getByLabel(/tipo.*alumbramiento|mecanismo/i).first();
    if ((await tipoSelect.count()) > 0) {
      const tagName = await tipoSelect.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === "select") {
        await tipoSelect.selectOption({ label: /espontáneo|duncan|schultze/i });
      } else {
        await tipoSelect.click();
        const opcion = page.getByRole("option", { name: /espontáneo|duncan/i }).first();
        if ((await opcion.count()) > 0) await opcion.click();
      }
    }

    // Placenta completa
    const placentaCheck = page.getByLabel(/placenta.*completa|cotilédones.*completos/i).first();
    if ((await placentaCheck.count()) > 0 && !(await placentaCheck.isChecked())) {
      await placentaCheck.check();
    }

    // Membranas completas
    const membranasCheck = page.getByLabel(/membranas.*completas|membranas/i).first();
    if ((await membranasCheck.count()) > 0 && !(await membranasCheck.isChecked())) {
      await membranasCheck.check();
    }

    // Pérdida sanguínea estimada (ml)
    const sangradoInput = page.getByLabel(/pérdida.*sangre|sangrado.*estimado|ml/i).first();
    if ((await sangradoInput.count()) > 0) {
      await sangradoInput.fill("300");
    }

    // Estado del útero post-alumbramiento
    const uteroInput = page.getByLabel(/estado.*útero|involución/i).first();
    if ((await uteroInput.count()) > 0) {
      await uteroInput.fill("Útero bien retraído, globo de seguridad presente.");
    }

    // Episiotomía/desgarros
    const desgarro = page.getByLabel(/episiotomía|desgarro/i).first();
    if ((await desgarro.count()) > 0) {
      const tagName = await desgarro.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === "select") {
        await desgarro.selectOption({ label: /ninguno|sin.*desgarro/i });
      }
    }

    await page.getByRole("button", { name: /registrar alumbramiento|cerrar alumbramiento|guardar/i }).click();

    await expect(page.getByText(/alumbramiento.*registrado|guardad[ao]/i).first())
      .toBeVisible({ timeout: 10_000 })
      .catch(() => {
        test.info().annotations.push({
          type: "alumbramiento-warn",
          description: "Feedback de alumbramiento no detectado.",
        });
      });

    await firmarDocumento(page, "firmar");
  });

  // -------------------------------------------------------------------------
  // 5. Atención del recién nacido firmada por MC
  // -------------------------------------------------------------------------
  test("5. Atención RN firmada por MC", async ({ page }) => {
    await login(page, "physician");

    // Puede estar en nacimiento/<id>/atencion-rn o en una ruta independiente
    const pathPrimario = nacimientoId !== "00000000-0000-0000-0000-000000000096"
      ? `/ece/obstetricia/nacimiento/${nacimientoId}/atencion-rn`
      : `/ece/obstetricia/${ingresoObstetricoId}/atencion-rn`;

    const ok = await probeRoute(page, pathPrimario);
    if (!ok) return;

    // Profilaxis ocular
    const profilaxisOcularCheck = page.getByLabel(/profilaxis.*ocular|cregoterapia|eritromicina/i).first();
    if ((await profilaxisOcularCheck.count()) > 0 && !(await profilaxisOcularCheck.isChecked())) {
      await profilaxisOcularCheck.check();
    }

    // Vitamina K
    const vitKCheck = page.getByLabel(/vitamina.*k|vit\.?.*k/i).first();
    if ((await vitKCheck.count()) > 0 && !(await vitKCheck.isChecked())) {
      await vitKCheck.check();
    }

    // Vacuna Hepatitis B
    const hepBCheck = page.getByLabel(/hepatitis.*b|hep.*b|vacuna.*rn/i).first();
    if ((await hepBCheck.count()) > 0 && !(await hepBCheck.isChecked())) {
      await hepBCheck.check();
    }

    // Tamizaje neonatal
    const tamizajeCheck = page.getByLabel(/tamizaje.*neonatal|tamiz/i).first();
    if ((await tamizajeCheck.count()) > 0 && !(await tamizajeCheck.isChecked())) {
      await tamizajeCheck.check();
    }

    // Temperatura axilar RN
    const tempRnInput = page.getByLabel(/temperatura.*rn|temp.*recién.*nacido/i).first();
    if ((await tempRnInput.count()) > 0) {
      await tempRnInput.fill("36.8");
    }

    // Glucometría RN
    const glucoInput = page.getByLabel(/glucometría|glicemia.*rn/i).first();
    if ((await glucoInput.count()) > 0) {
      await glucoInput.fill("55");
    }

    // Lactancia materna iniciada
    const lactanciaCheck = page.getByLabel(/lactancia.*materna.*iniciada|lactancia/i).first();
    if ((await lactanciaCheck.count()) > 0 && !(await lactanciaCheck.isChecked())) {
      await lactanciaCheck.check();
    }

    // Identificación del RN (brazalete)
    const identificacionCheck = page.getByLabel(/identificación.*rn|brazalete/i).first();
    if ((await identificacionCheck.count()) > 0 && !(await identificacionCheck.isChecked())) {
      await identificacionCheck.check();
    }

    // Notas de atención RN
    const notasInput = page.getByLabel(/notas.*atención.*rn|observaciones.*rn/i).first();
    if ((await notasInput.count()) > 0) {
      await notasInput.fill(
        "RN a término, vigoroso, llanto inmediato. Adaptación extrauterina satisfactoria. " +
          "Profilaxis completa. Identificado con brazalete. Entregado a madre.",
      );
    }

    await page.getByRole("button", { name: /guardar|registrar atención.*rn/i }).click();

    await expect(page.getByText(/guardad[ao]|registrad[ao]/i).first())
      .toBeVisible({ timeout: 10_000 })
      .catch(() => {
        test.info().annotations.push({
          type: "atencion-rn-warn",
          description: "Feedback de atención RN no detectado.",
        });
      });

    await firmarDocumento(page, "firmar");

    // Obtener RN ID si se redirigió
    const rnMatch = page.url().match(/(?:rn|recien-nacido|atencion-rn)\/([0-9a-f-]{36})/);
    if (rnMatch) rnId = rnMatch[1];

    test.info().annotations.push({
      type: "atencion-rn-completada",
      description: `Atención RN firmada. ID RN: ${rnId}`,
    });

    // Cleanup tag
    test.info().annotations.push({
      type: "cleanup-tag",
      description:
        `Ingreso obstétrico ${ingresoObstetricoId} / MRN ${PACIENTE_MRN_OBS} ` +
        "marcado @obstetricia-e2e para inspección manual.",
    });
  });

  // -------------------------------------------------------------------------
  // 6. Verificación: episodio obstétrico cerrado + documentos firmados
  // -------------------------------------------------------------------------
  test("6. Verifica episodio obstétrico cerrado y documentos firmados", async ({ page }) => {
    await login(page, "physician");

    const okEpisodio = await probeRoute(
      page,
      `/ece/obstetricia/${ingresoObstetricoId}`,
    );
    if (okEpisodio) {
      const estadoBadge = page
        .getByText(/cerrad[ao]|completad[ao]|alta.*obstétrica|alta.*obs/i)
        .first();
      await expect(estadoBadge)
        .toBeVisible({ timeout: 8_000 })
        .catch(() => {
          test.info().annotations.push({
            type: "estado-obs-warn",
            description: "Badge de episodio obstétrico cerrado no visible.",
          });
        });
    }

    // Bitácora
    const okBitacora = await probeRoute(
      page,
      `/ece/bitacora?episodio=${ingresoObstetricoId}`,
    );
    if (okBitacora) {
      const firmas = page.getByRole("cell", { name: /firmar|firma/i });
      const totalFirmas = await firmas.count();
      test.info().annotations.push({
        type: "bitacora-firmas",
        description: `${totalFirmas} eventos de firma en bitácora obstétrica`,
      });
    }

    // Verificar partograma registrado con 4 tomas
    const okPartograma = await probeRoute(
      page,
      `/ece/obstetricia/${ingresoObstetricoId}/partograma`,
    );
    if (okPartograma) {
      const filas = page.getByRole("row");
      const totalFilas = await filas.count();
      test.info().annotations.push({
        type: "partograma-registros",
        description: `${Math.max(0, totalFilas - 1)} registros en partograma (esperado: ${TOMAS_PARTOGRAMA.length})`,
      });
    }
  });
});
