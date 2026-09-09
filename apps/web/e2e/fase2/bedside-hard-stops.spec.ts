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
   * NO se puede ejercitar hoy. Con los dos fixes de este cambio (query de
   * indicación en bedside.router.ts + el wizard ya respeta `ok:false`), un
   * escaneo 100% correcto SÍ pasa la Regla de los 5 Correctos — pero el paso
   * siguiente (`bedside.administration.record`) tiene un gap de arquitectura
   * previo, no relacionado con este spec:
   *
   *   1. `administration.record` (bedside.router.ts:371) resuelve
   *      `prescriptionItemId` con
   *      `SELECT prescription_item_id FROM ece.indicaciones_medicas WHERE id = $1`.
   *      Esa columna NUNCA existió — ni en el corpus SQL (sql/61, sql/98) ni
   *      en schema.prisma (EceIndicacionesMedicas). Lanza 42703 para
   *      cualquier indicationId nativo de ECE.
   *   2. Aun si (1) se resolviera, `ece.indicacion_item` (el modelo ECE de
   *      indicación) no tiene ningún vínculo estructurado a
   *      public."PrescriptionItem" (que exige drugId NOT NULL) — el propio
   *      repo documenta por qué construir ese puente automáticamente es
   *      inseguro (packages/database/sql/201_ece_indicacion_farmacia_pendiente.sql,
   *      cola de conciliación manual en su lugar). No hay bridge que sembrar.
   *   3. El check de ventana terapéutica de `validate5Correctos`
   *      (bedside.router.ts:1046) consulta
   *      `"MedicationAdministration" WHERE "orderId" = $1` — esa columna no
   *      existe en el modelo (ni con ese nombre ni mapeada) y, aunque
   *      existiera, `MedicationAdministration` no tiene forma de
   *      referenciar un indicationId de ECE. Y la tabla de destino de la
   *      rama OK, `ece.bedside_validation` (sql/91), no tiene modelo en
   *      schema.prisma — `prisma db push` (BD efímera E2E) nunca la crea,
   *      así que el INSERT final de la rama OK (sin try/catch) revienta
   *      igual aunque (1) y (2) se resuelvan.
   *
   * Ninguno de los tres es un defecto de este spec ni de sus fixtures —
   * son gaps de backend preexistentes, más grandes que "resucitar el E2E".
   * Se documentan aquí en vez de forzar un test verde falso. Ver también el
   * reporte de @QA de esta sesión para el hallazgo completo (severidad P0
   * para Go-Live del circuito BCMA).
   */
  test.fixme(
    "caso feliz: 3 escaneos válidos → success con administrationId " +
      "(bloqueado por gap de arquitectura en administration.record — ver comentario)",
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
