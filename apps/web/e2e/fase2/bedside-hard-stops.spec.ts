/**
 * E2E — Bedside Hard Stops (US.F2.6.27-30, Sprint F2-S7).
 *
 * Resucitado 2026-09 — el spec anterior tenía DOBLE drift documentado en la
 * memoria del proyecto (2026-08-29) y nunca corrió contra la app real:
 *
 *   (a) spec↔UI: usaba testids inexistentes (`gsrn-profesional-input`, …) y
 *       un orden de pasos invertido. El wizard real
 *       (administration-wizard.tsx + scan-step.tsx) es
 *       PACIENTE → ENFERMERA → MEDICAMENTO, y la validación server-side
 *       (bedside.validate5Correct.validate) se dispara recién DESPUÉS de
 *       completar el paso 3 — no hay hard-stop posible en los pasos 1/2
 *       (esos sólo validan formato GSRN-18 en el cliente).
 *
 *   (b) router↔schema: `runValidate5Correctos` (bedside.router.ts) consultaba
 *       columnas inexistentes de ece.indicaciones_medicas
 *       (patient_id/gtin_medicamento/dosis/via_administracion/frecuencia/
 *       estado — 42703 siempre). Corregido en este mismo cambio: el
 *       encabezado sólo tiene `paciente_id` directo; gtin/dosis/via/
 *       frecuencia viven en el ítem hijo ece.indicacion_item — ver el fix en
 *       bedside.router.ts (query de "Paso 2: Cargar indicación médica").
 *
 *   Además se encontró un bug de cliente independiente: `handleMedicationScan`
 *   en administration-wizard.tsx invocaba `validate5Correct.mutateAsync` pero
 *   DESCARTABA el resultado — un hard-stop de los 5-correctos no lanza
 *   excepción (resuelve normalmente con `{ ok: false, hardStop, reason }`),
 *   así que el wizard avanzaba a registrar la administración incluso cuando
 *   el servidor detectó un hard-stop. También corregido en este cambio.
 *
 * Mecanismo de escaneo simulado (DoD §4.2 anti-manual-entry, scan-step.tsx):
 *   El campo de cada paso NO es readOnly=true; en su lugar el listener
 *   `onInput` mide el tiempo entre el primer keydown registrado y el evento
 *   input, y sólo acepta el valor si `elapsed <= SCAN_THRESHOLD_MS` (80ms).
 *   `locator.fill()` de Playwright fija el value vía el setter nativo y
 *   dispara UN solo evento "input" — sin ningún "keydown" previo. Como
 *   `firstCharTimeRef.current` nunca se pobló (ningún keydown ocurrió),
 *   `handleInput` usa `firstTime = firstCharTimeRef.current ?? now` → 0ms de
 *   elapsed → pasa el umbral igual que un scan real de pistola HID. No hace
 *   falta `page.evaluate` ni disparar eventos sintéticos: `.fill()` sobre el
 *   testid del input reproduce exactamente la condición que el componente
 *   espera. Verificado leyendo scan-step.tsx (handleInput, líneas ~120-151).
 *
 * Cobertura de esta suite (@smoke):
 *   - HS: GSRN de pulsera no registrado en ece.gs1_gsrn → hard-stop
 *     GSRN_PACIENTE_NO_ENCONTRADO, sin llamada a administration.record.
 *   - HS: GTIN escaneado no coincide con la indicación → hard-stop
 *     MEDICAMENTO_NO_COINCIDE, sin llamada a administration.record.
 *   - Caso feliz (3 escaneos válidos → success con administrationId):
 *     marcado con `test.fixme()` — ver el bloque de comentario en esa
 *     sección para el detalle de los 3 defectos de backend, independientes
 *     de este spec, que lo bloquean hoy.
 *
 * Fixtures: packages/database/scripts/seed-e2e-fixtures.mjs (§4 y §5) siembra
 * la indicación firmada + catálogo GS1 que este spec consume — ver
 * apps/web/e2e/_helpers/fixtures.ts (E2E_FIXTURES.indicationId, E2E_GS1.*).
 * No requirió cambios: lo sembrado por PR #599 ya alcanza para ambos
 * hard-stops.
 */

import { test, expect, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { E2E_FIXTURES, E2E_GS1 } from "../_helpers/fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function goToWizard(page: Page) {
  await page.goto(`/bedside/${E2E_FIXTURES.patientId}/${E2E_FIXTURES.indicationId}`);
  await expect(page).toHaveURL(/\/bedside\//);
}

/** Simula un scan HID/BarcodeDetector — ver razonamiento en el header del archivo. */
async function scan(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).fill(value);
}

/** Construye el DataMatrix GS1 (AI 01/10/17) que espera parseGs1DataMatrix. */
function dataMatrix(gtin: string, lote: string, vencimientoYYMMDD: string) {
  return `(01)${gtin}(10)${lote}(17)${vencimientoYYMMDD}`;
}

async function assertHardStop(page: Page, textFragment: RegExp) {
  const modal = page.getByTestId("hard-stop-modal");
  await expect(modal).toBeVisible({ timeout: 8_000 });
  await expect(modal).toHaveAttribute("aria-live", "assertive");
  await expect(modal.getByText(textFragment)).toBeVisible();
  // El botón de cancelar está disponible; no existe ningún control para
  // continuar/confirmar la administración desde la pantalla de hard-stop.
  await expect(modal.getByRole("button", { name: /cancelar/i })).toBeVisible();
  await expect(modal.getByRole("button", { name: /reiniciar/i })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("@smoke - Bedside — Hard Stops (US.F2.6.27-30)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "nurse");
  });

  test("HS: GSRN de pulsera no registrado → hard-stop, sin administración", async ({ page }) => {
    const adminRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("administration.record")) adminRequests.push(req.url());
    });

    await goToWizard(page);

    // Paso 1 — GSRN con formato válido (18 dígitos) pero nunca sembrado.
    await scan(page, "bedside-scan-patient", E2E_GS1.gsrnPacienteNoRegistrado);
    // Paso 2 — enfermera válida y activa.
    await scan(page, "bedside-scan-nurse", E2E_GS1.gsrnEnfermera);
    // Paso 3 — medicamento correcto (el hard-stop es por paciente, no por esto).
    await scan(
      page,
      "bedside-scan-medication",
      dataMatrix(E2E_GS1.gtinAmoxicilina500, "L-E2E-HS1", "291231"),
    );

    await assertHardStop(page, /no registrado|GSRN/i);
    expect(adminRequests).toHaveLength(0);
  });

  test("HS: GTIN escaneado no coincide con la indicación → hard-stop, sin administración", async ({
    page,
  }) => {
    const adminRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("administration.record")) adminRequests.push(req.url());
    });

    await goToWizard(page);

    // Pasos 1 y 2 — paciente y enfermera correctos y registrados.
    await scan(page, "bedside-scan-patient", E2E_GS1.gsrnPaciente);
    await scan(page, "bedside-scan-nurse", E2E_GS1.gsrnEnfermera);
    // Paso 3 — Ibuprofeno 400mg escaneado; la indicación pide Amoxicilina 500mg.
    await scan(
      page,
      "bedside-scan-medication",
      dataMatrix(E2E_GS1.gtinIbuprofeno400, "L-E2E-HS2", "291231"),
    );

    await assertHardStop(page, /no coincide|MEDICAMENTO/i);
    expect(adminRequests).toHaveLength(0);
  });

  /**
   * Caso feliz — 3 escaneos válidos → success con administrationId.
   *
   * Ejercita el circuito BCMA completo: validate5Correct (5 Correctos OK →
   * fila en ece.bedside_validation + evento EPCIS) y administration.record,
   * que resuelve el PrescriptionItem vía la cola de conciliación de farmacia
   * `ece.indicacion_farmacia_pendiente` (R04, sql/201 + sql/222): el seeder
   * siembra la fila RECONCILIADO → Drug/receta estructurados
   * (seed-e2e-fixtures.mjs §6). Sin fila conciliada, record bloquea con
   * PRECONDITION_FAILED — quién escribe esa conciliación en producción
   * (farmacia manual vs generación automática al firmar) es la decisión
   * R06/ADR 0023, pendiente de dirección; este test cubre el circuito una
   * vez que el vínculo existe.
   */
  test(
    "caso feliz: 3 escaneos válidos → success con administrationId",
    async ({ page }) => {
      await goToWizard(page);
      await scan(page, "bedside-scan-patient", E2E_GS1.gsrnPaciente);
      await scan(page, "bedside-scan-nurse", E2E_GS1.gsrnEnfermera);
      await scan(
        page,
        "bedside-scan-medication",
        dataMatrix(E2E_GS1.gtinAmoxicilina500, "L-E2E-OK", "291231"),
      );

      await expect(page.getByTestId("administration-success")).toBeVisible({ timeout: 8_000 });
      await expect(page.getByTestId("administration-id")).toContainText(/ID:/);
    },
  );
});
