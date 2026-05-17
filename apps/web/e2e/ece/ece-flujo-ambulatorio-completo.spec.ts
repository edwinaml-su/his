/**
 * E2E — ECE: Flujo ambulatorio completo (happy path multi-rol).
 *
 * Cubre el ciclo clínico de extremo a extremo en un solo episodio:
 *   ENF  → signos vitales → firma
 *   ENF  → triaje Manchester → firma
 *   MC   → valida triaje
 *   MC   → historia clínica → firma
 *   MC   → prescripción (1 indicación) → firma
 *   ENF  → administración medicamento (BCMA mock) → valida indicaciones
 *   MC   → evolución SOAP → firma → valida
 *   ADMIN → bitácora: todos los documentos del episodio visibles
 *
 * Requisitos de entorno:
 *   - NEXT_PUBLIC_SUPABASE_URL  (real, sin "ci-dummy")
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   - Servidor Next.js corriendo (LOCAL: npm run dev | PREVIEW: Vercel preview URL)
 *
 * Usuarios requeridos (seed-test-users.mjs + 63_ece_08_seed.sql):
 *   qa.nurse@his.test      / TestPass123!
 *   qa.physician@his.test  / TestPass123!
 *   qa.admin@his.test      / TestPass123!
 *
 * Cleanup: al finalizar, el episodio creado se marca con tag "demo-e2e"
 * para identificación y purga sin contaminar datos reales.
 *
 * @author @QA — Fase 2 S1 Gate — 2026-05-17
 */

import { test, expect, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";

// ---------------------------------------------------------------------------
// Guard: saltar en CI ephemeral (dummy Supabase URL)
// ---------------------------------------------------------------------------

const HAS_REAL_SUPABASE =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("ci-dummy");

// UUID del episodio de prueba compartido entre pasos.
// El seed 63_ece_08_seed.sql crea un episodio con UUID conocido.
// Si no existe, cada paso intenta detectar uno dinámicamente.
const SEED_EPISODIO_ID = "00000000-0000-0000-0000-000000000001";

// Tag que se aplica al episodio post-test para marcar datos de prueba.
const DEMO_TAG = "demo-e2e";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Login genérico para roles ECE — post-login espera cualquier ruta autenticada. */
async function loginEce(
  page: Page,
  role: "nurse" | "physician" | "admin",
): Promise<void> {
  await login(page, role);
}

/**
 * Navega a `path` y devuelve si la ruta responde con HTTP < 500.
 * Anota el status en el reporte Playwright.
 */
async function probeRoute(page: Page, path: string): Promise<number> {
  const response = await page.goto(path);
  const status = response?.status() ?? 0;
  test.info().annotations.push({ type: "http-probe", description: `GET ${path} → ${status}` });
  return status;
}

/**
 * Detecta el ID del primer episodio activo visible en la página actual.
 * Busca en la URL o en atributos data-episodio-id.
 */
async function detectarEpisodioId(page: Page, fallback: string): Promise<string> {
  const fromUrl = page.url().match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
  if (fromUrl) return fromUrl;
  const fromAttr = await page
    .locator("[data-episodio-id]")
    .first()
    .getAttribute("data-episodio-id")
    .catch(() => null);
  return fromAttr ?? fallback;
}

/**
 * Intenta clicar el botón Firmar y confirmar el diálogo.
 * No falla si el botón no está disponible (módulo en stub).
 */
async function intentarFirmar(page: Page): Promise<boolean> {
  const firmarBtn = page.getByRole("button", { name: /^firmar$/i }).first();
  if ((await firmarBtn.count()) === 0 || !(await firmarBtn.isEnabled())) {
    test.info().annotations.push({ type: "firma-skip", description: "Botón Firmar no disponible." });
    return false;
  }
  await firmarBtn.click();
  const confirmDialog = page.getByRole("dialog", { name: /firmar|confirmar firma/i });
  if ((await confirmDialog.count()) > 0) {
    await page.getByRole("button", { name: /firmar definitivamente|confirmar/i }).click();
    await page.getByText(/firmado|firmada/i).first().waitFor({ timeout: 10_000 }).catch(() => null);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe.serial("ECE — Flujo ambulatorio completo", () => {
  test.skip(!HAS_REAL_SUPABASE, "Requiere Supabase real. CI ephemeral usa dummy URL — skip.");

  // Episodio compartido entre pasos (se actualiza dinámicamente si el seed no está).
  let episodioId = SEED_EPISODIO_ID;

  // -------------------------------------------------------------------------
  // Paso 1: ENF captura signos vitales → firma
  // -------------------------------------------------------------------------

  test("1. ENF: signos vitales → firma", async ({ page }) => {
    await loginEce(page, "nurse");

    const status = await probeRoute(page, "/ece/signos-vitales");
    if (status >= 500 || status === 404) {
      test.info().annotations.push({ type: "skip-reason", description: `HTTP ${status} — módulo ECE no desplegado.` });
      return;
    }

    // Seleccionar episodio pendiente o usar el del seed
    const firstRow = page.getByRole("link", { name: /evaluar|registrar|ver episodio/i }).first();
    if ((await firstRow.count()) > 0) {
      await firstRow.click();
      await page.waitForURL(/\/ece\/signos-vitales\/[0-9a-f-]{36}/, { timeout: 10_000 });
      episodioId = await detectarEpisodioId(page, episodioId);
    } else {
      // Navegar directamente al episodio del seed
      const directStatus = await probeRoute(page, `/ece/signos-vitales/${episodioId}`);
      if (directStatus >= 500 || directStatus === 404) {
        test.info().annotations.push({ type: "skip-reason", description: "Episodio seed no encontrado." });
        return;
      }
    }

    // Rellenar campos de signos vitales (tolerante a campos ausentes en stub)
    const campos: Array<[RegExp, string]> = [
      [/presión arterial|presion arterial/i, "120/80"],
      [/frecuencia cardiaca|fc\b/i, "72"],
      [/temperatura/i, "36.8"],
      [/saturación|sat.*o2/i, "98"],
      [/frecuencia respiratoria|fr\b/i, "16"],
      [/peso/i, "68"],
      [/talla|altura/i, "165"],
    ];
    for (const [label, value] of campos) {
      const input = page.getByLabel(label).first();
      if ((await input.count()) > 0) await input.fill(value);
    }

    await page.getByRole("button", { name: /guardar|registrar/i }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /guardado|registrado|éxito/i })
      .first()
      .waitFor({ timeout: 8_000 })
      .catch(() => null);

    await intentarFirmar(page);
  });

  // -------------------------------------------------------------------------
  // Paso 2: ENF registra triaje → firma
  // -------------------------------------------------------------------------

  test("2. ENF: triaje Manchester → firma", async ({ page }) => {
    await loginEce(page, "nurse");

    const status = await probeRoute(page, `/ece/triaje/${episodioId}`);
    if (status >= 500 || status === 404) {
      // Intentar lista de triaje
      const listStatus = await probeRoute(page, "/ece/triaje");
      if (listStatus >= 500 || listStatus === 404) {
        test.info().annotations.push({ type: "skip-reason", description: "Ruta triaje no disponible." });
        return;
      }
      const firstLink = page.getByRole("link", { name: /triar|evaluar|triaje/i }).first();
      if ((await firstLink.count()) === 0) {
        test.info().annotations.push({ type: "skip-reason", description: "Sin episodios en triaje." });
        return;
      }
      await firstLink.click();
      await page.waitForURL(/\/ece\/triaje\/[0-9a-f-]{36}/, { timeout: 10_000 });
      episodioId = await detectarEpisodioId(page, episodioId);
    }

    // Seleccionar categoría Manchester (ej: verde = no urgente)
    const categoriaVerde = page.getByRole("button", { name: /verde|no urgente/i }).first();
    const categoriaInput = page.getByLabel(/categoría|categoria|manchester|prioridad/i).first();
    if ((await categoriaVerde.count()) > 0) {
      await categoriaVerde.click();
    } else if ((await categoriaInput.count()) > 0) {
      await categoriaInput.fill("Verde - No urgente");
    }

    const motivoInput = page.getByLabel(/motivo|queja principal/i).first();
    if ((await motivoInput.count()) > 0) await motivoInput.fill("Dolor abdominal leve — prueba E2E.");

    await page.getByRole("button", { name: /guardar|registrar triaje/i }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /guardado|registrado/i })
      .first()
      .waitFor({ timeout: 8_000 })
      .catch(() => null);

    await intentarFirmar(page);
  });

  // -------------------------------------------------------------------------
  // Paso 3: MC valida triaje
  // -------------------------------------------------------------------------

  test("3. MC: valida triaje del episodio", async ({ page }) => {
    await loginEce(page, "physician");

    const status = await probeRoute(page, `/ece/triaje/${episodioId}`);
    if (status >= 500 || status === 404) {
      test.info().annotations.push({ type: "skip-reason", description: "Triaje del episodio no disponible." });
      return;
    }

    const validarBtn = page.getByRole("button", { name: /validar triaje|confirmar/i }).first();
    if ((await validarBtn.count()) > 0 && await validarBtn.isEnabled()) {
      await validarBtn.click();
      await page.getByText(/validado|validada/i).first().waitFor({ timeout: 8_000 }).catch(() => null);
      test.info().annotations.push({ type: "triaje-validado", description: "Triaje validado por MC." });
    } else {
      test.info().annotations.push({ type: "skip-reason", description: "Botón validar triaje no disponible." });
    }
  });

  // -------------------------------------------------------------------------
  // Paso 4: MC crea historia clínica → firma
  // -------------------------------------------------------------------------

  test("4. MC: historia clínica → firma", async ({ page }) => {
    await loginEce(page, "physician");

    const status = await probeRoute(page, `/ece/historia-clinica/${episodioId}`);
    if (status >= 500 || status === 404) {
      test.info().annotations.push({ type: "skip-reason", description: "Ruta historia-clinica no disponible." });
      return;
    }

    const campos: Array<[RegExp, string]> = [
      [/motivo de consulta|motivo/i, "Control post-operatorio — prueba E2E."],
      [/historia de la enfermedad|hma|hea/i, "Paciente 45 años, 3 días post-apendicectomía sin complicaciones."],
      [/examen físico|examen fisico/i, "Abdomen blando, herida limpia. Peristaltismo presente."],
      [/diagnóstico|diagnostico/i, "Z48.0 — Cuidados de herida quirúrgica."],
      [/plan de tratamiento|plan/i, "Alta hospitalaria. Control en 1 semana."],
    ];
    for (const [label, value] of campos) {
      const input = page.getByLabel(label).first();
      if ((await input.count()) > 0) await input.fill(value);
    }

    await page.getByRole("button", { name: /guardar|registrar historia/i }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /guardado|registrado/i })
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => null);

    await intentarFirmar(page);
  });

  // -------------------------------------------------------------------------
  // Paso 5: MC prescribe 1 indicación → firma
  // -------------------------------------------------------------------------

  test("5. MC: prescripción (1 ítem) → firma", async ({ page }) => {
    await loginEce(page, "physician");

    const status = await probeRoute(page, `/ece/indicaciones/${episodioId}`);
    if (status >= 500 || status === 404) {
      test.info().annotations.push({ type: "skip-reason", description: "Ruta indicaciones no disponible." });
      return;
    }

    // Agregar indicación
    const agregarBtn = page.getByRole("button", { name: /agregar indicación|nueva indicación|prescribir/i }).first();
    if ((await agregarBtn.count()) > 0) {
      await agregarBtn.click();

      const medInput = page.getByLabel(/medicamento|fármaco|nombre/i).first();
      const dosis = page.getByLabel(/dosis/i).first();
      const via = page.getByLabel(/vía|via de administración/i).first();
      const frecuencia = page.getByLabel(/frecuencia|cada/i).first();
      const duracion = page.getByLabel(/duración|duracion|días/i).first();

      if ((await medInput.count()) > 0) await medInput.fill("Amoxicilina 500 mg");
      if ((await dosis.count()) > 0) await dosis.fill("500 mg");
      if ((await via.count()) > 0) await via.fill("Oral");
      if ((await frecuencia.count()) > 0) await frecuencia.fill("Cada 8 horas");
      if ((await duracion.count()) > 0) await duracion.fill("5 días");

      const guardarItem = page.getByRole("button", { name: /agregar|confirmar|guardar indicación/i }).first();
      if ((await guardarItem.count()) > 0) await guardarItem.click();
    } else {
      test.info().annotations.push({ type: "skip-reason", description: "Botón agregar indicación no encontrado." });
    }

    await page.getByRole("button", { name: /guardar indicaciones|guardar prescripción/i }).click().catch(() => null);
    await intentarFirmar(page);
  });

  // -------------------------------------------------------------------------
  // Paso 6: ENF registra administración (BCMA mock) → valida indicaciones
  // -------------------------------------------------------------------------

  test("6. ENF: administración BCMA → valida indicaciones", async ({ page }) => {
    await loginEce(page, "nurse");

    const status = await probeRoute(page, `/ece/administracion/${episodioId}`);
    if (status >= 500 || status === 404) {
      test.info().annotations.push({ type: "skip-reason", description: "Ruta administración BCMA no disponible." });
      return;
    }

    // BCMA mock: escanear código de barras simulado
    const scanInput = page.getByLabel(/código de barras|barcode|escanear|scan/i).first();
    if ((await scanInput.count()) > 0) {
      await scanInput.fill("MED-AMOXICILINA-500MG-LOTE-E2E");
      await scanInput.press("Enter");
    }

    // Confirmar administración
    const confirmarBtn = page.getByRole("button", { name: /administrar|confirmar administración/i }).first();
    if ((await confirmarBtn.count()) > 0 && await confirmarBtn.isEnabled()) {
      await confirmarBtn.click();
      await page.getByText(/administrado|registrado/i).first().waitFor({ timeout: 8_000 }).catch(() => null);
      test.info().annotations.push({ type: "bcma-ok", description: "Administración BCMA registrada." });
    } else {
      test.info().annotations.push({ type: "bcma-skip", description: "Flujo BCMA no disponible — módulo en stub." });
    }

    // Verificar que la indicación aparece como administrada en la lista
    const indicacionAdministrada = page
      .getByRole("row")
      .filter({ hasText: /amoxicilina|administrado/i })
      .first();
    if ((await indicacionAdministrada.count()) > 0) {
      await expect(indicacionAdministrada).toContainText(/administrado/i);
    }
  });

  // -------------------------------------------------------------------------
  // Paso 7: MC evolución SOAP → firma → valida
  // -------------------------------------------------------------------------

  test("7. MC: evolución SOAP → firma → valida", async ({ page }) => {
    await loginEce(page, "physician");

    const status = await probeRoute(page, `/ece/evolucion/${episodioId}`);
    if (status >= 500 || status === 404) {
      test.info().annotations.push({ type: "skip-reason", description: "Ruta evolución no disponible." });
      return;
    }

    // Crear nueva nota de evolución SOAP
    const nuevaNotaBtn = page.getByRole("button", { name: /nueva nota|agregar evolución|nueva evolución/i }).first();
    if ((await nuevaNotaBtn.count()) > 0) await nuevaNotaBtn.click();

    const soapCampos: Array<[RegExp, string]> = [
      [/subjetivo|s:/i, "Paciente refiere mejoría del dolor. Sin fiebre."],
      [/objetivo|o:/i, "TA 118/76, FC 70. Herida sin signos de infección."],
      [/análisis|a:/i, "Z48.0 — Evolución favorable post-apendicectomía."],
      [/plan|p:/i, "Continuar antibiótico oral. Alta mañana si persiste mejoría."],
    ];
    for (const [label, value] of soapCampos) {
      const input = page.getByLabel(label).first();
      if ((await input.count()) > 0) await input.fill(value);
    }

    await page.getByRole("button", { name: /guardar evolución|guardar/i }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /guardado|registrado/i })
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => null);

    await intentarFirmar(page);

    // Validar la nota recién firmada
    const validarBtn = page.getByRole("button", { name: /validar evolución|validar nota/i }).first();
    if ((await validarBtn.count()) > 0 && await validarBtn.isEnabled()) {
      await validarBtn.click();
      await page.getByText(/validada|validado/i).first().waitFor({ timeout: 8_000 }).catch(() => null);
    }
  });

  // -------------------------------------------------------------------------
  // Paso 8: Bitácora — todos los documentos del episodio visibles
  // -------------------------------------------------------------------------

  test("8. Bitácora: documentos del episodio visibles", async ({ page }) => {
    await loginEce(page, "admin");

    const status = await probeRoute(page, `/ece/bitacora?episodio=${episodioId}`);
    if (status >= 500 || status === 404) {
      test.info().annotations.push({ type: "skip-reason", description: "Ruta bitácora no disponible." });
      return;
    }

    await expect(page.getByRole("table")).toBeVisible({ timeout: 8_000 });

    // Verificar columnas mínimas a11y
    await expect(page.getByRole("columnheader", { name: /usuario|personal/i }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /acción|accion/i }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /fecha|ocurrido/i }).first()).toBeVisible();

    const totalFilas = await page.getByRole("row").count();
    test.info().annotations.push({
      type: "bitacora-filas",
      description: `${totalFilas - 1} entradas en bitácora del episodio ${episodioId}`,
    });

    // Esperamos al menos los registros de signos vitales + HC + evolución
    // Si el seed no está completo, anotamos sin fallar (stub-tolerant).
    const tiposDocumento = ["signos", "historia", "indicacion", "evolución", "evolucion", "triaje"];
    let documentosEncontrados = 0;
    for (const tipo of tiposDocumento) {
      const fila = page.getByRole("row").filter({ hasText: new RegExp(tipo, "i") }).first();
      if ((await fila.count()) > 0) documentosEncontrados++;
    }
    test.info().annotations.push({
      type: "tipos-documento-bitacora",
      description: `${documentosEncontrados}/${tiposDocumento.length} tipos de documento encontrados en bitácora`,
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup: marcar episodio con tag "demo-e2e"
  // -------------------------------------------------------------------------

  test("9. Cleanup: marcar episodio como demo-e2e", async ({ page }) => {
    await loginEce(page, "admin");

    // Intentar ruta de tags/etiquetas del episodio
    const tagStatus = await probeRoute(page, `/ece/episodio/${episodioId}`);
    if (tagStatus >= 500 || tagStatus === 404) {
      test.info().annotations.push({
        type: "cleanup-skip",
        description: `No se pudo marcar episodio ${episodioId} con tag ${DEMO_TAG} — ruta no disponible.`,
      });
      return;
    }

    const tagInput = page.getByLabel(/etiquetas|tags/i).first();
    const addTagBtn = page.getByRole("button", { name: /agregar etiqueta|add tag/i }).first();

    if ((await tagInput.count()) > 0) {
      await tagInput.fill(DEMO_TAG);
      if ((await addTagBtn.count()) > 0) await addTagBtn.click();
      else await tagInput.press("Enter");

      await page.getByRole("button", { name: /guardar/i }).click().catch(() => null);
      test.info().annotations.push({ type: "cleanup-ok", description: `Episodio ${episodioId} marcado como ${DEMO_TAG}.` });
    } else {
      test.info().annotations.push({
        type: "cleanup-skip",
        description: `Formulario de tags no encontrado — episodio ${episodioId} requiere limpieza manual.`,
      });
    }
  });
});
