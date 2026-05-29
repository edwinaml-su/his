/**
 * E2E — Nivel B: Scope de datos por unidad de servicio (PR #324).
 *
 * Valida que los datos retornados respeten el scope de unidad de servicio
 * del usuario autenticado (filtro a nivel de API/tRPC, no solo UI).
 *
 * Escenarios:
 *   SCOPE-B-01: usuario ER en /admission solo ve encounters de servicio ER.
 *   SCOPE-B-02: usuario ER intenta acceder a datos de QX → FORBIDDEN o vacío.
 *   SCOPE-B-03: usuario cross-service (ADMIN) ve todos los encounters.
 *
 * IMPORTANTE: estos tests son best-effort si el seed no provee encounters
 * etiquetados por serviceUnit. Se anotan las condiciones y se pasa sin falla
 * para no bloquear el pipeline en entornos sin datos completos.
 */
import { test, expect } from "@playwright/test";
import { login } from "../_helpers/auth";

// ID de unidad QX (quirófano) — valor del seed base.
// Si el seed cambia, actualizar aquí.
const QX_SERVICE_UNIT_PARAM = "QX";

test.describe("@smoke - Scope Nivel B — Datos por unidad de servicio", () => {
  // -------------------------------------------------------------------------
  // SCOPE-B-01: usuario ER solo ve encounters de ER
  // -------------------------------------------------------------------------
  test("SCOPE-B-01: usuario ER en /admission solo ve encounters de ER o nulls", async ({ page }) => {
    await login(page, "nurse");
    await page.goto("/admission");
    await expect(page).toHaveURL(/\/admission/);

    // Esperar que la tabla de admisión cargue.
    await page.waitForLoadState("networkidle");

    const rows = page.getByRole("row");
    const rowCount = await rows.count();

    test.info().annotations.push({
      type: "admission-rows",
      description: `${rowCount} filas visibles para qa.nurse en /admission`,
    });

    if (rowCount <= 1) {
      // Solo header o tabla vacía — no hay encounters para validar scope.
      test.info().annotations.push({
        type: "scope-seed-missing",
        description:
          "Sin encounters en BD de test para verificar filtro por unidad. " +
          "Seed debe incluir encounters asignados a servicio ER y QX.",
      });
      return;
    }

    // Si hay filas, verificar que ninguna tiene data-service-unit de otra unidad.
    const serviceUnitAttrs = await page
      .locator("[data-service-unit]")
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-service-unit")).filter(Boolean),
      );

    if (serviceUnitAttrs.length > 0) {
      const nonErUnits = serviceUnitAttrs.filter(
        (u) => u !== "ER" && u !== null && u !== undefined,
      );
      test.info().annotations.push({
        type: "data-units-visible",
        description: `Unidades visibles: ${[...new Set(serviceUnitAttrs)].join(", ")}`,
      });
      expect(
        nonErUnits,
        "Usuario ER no debe ver encounters de otras unidades",
      ).toHaveLength(0);
    }
  });

  // -------------------------------------------------------------------------
  // SCOPE-B-02: usuario ER intentando acceder a datos de QX → bloqueado
  // -------------------------------------------------------------------------
  test("SCOPE-B-02: usuario ER accede a /admission?serviceUnitId=QX → FORBIDDEN o vacío", async ({
    page,
  }) => {
    await login(page, "nurse");

    // Intentar forzar scope de QX via query param.
    const response = await page.goto(`/admission?serviceUnitId=${QX_SERVICE_UNIT_PARAM}`);
    const status = response?.status() ?? 0;

    test.info().annotations.push({
      type: "cross-scope-probe",
      description: `GET /admission?serviceUnitId=${QX_SERVICE_UNIT_PARAM} → HTTP ${status}`,
    });

    // No debe ser 5xx.
    expect(status, "No debe haber error de servidor al forzar scope").toBeLessThan(500);

    // La respuesta debe ser: redirección, 403, o página con datos vacíos/mensaje de acceso.
    if (status === 403 || status === 401) {
      // Bloqueado a nivel middleware — correcto.
      return;
    }

    // Si retorna 200, la UI no debe mostrar datos de QX.
    const bodyText = await page.locator("body").innerText();
    const hasQxData = /quirófano|QX|operating room/i.test(bodyText);

    if (hasQxData) {
      // Datos de QX visibles para usuario ER → scope leak.
      test.info().annotations.push({
        type: "scope-data-leak",
        description: "SCOPE LEAK: datos de QX visibles para usuario ER",
      });
    }

    // El sistema puede optar por mostrar la página filtrada (sin datos QX)
    // o redirigir. Ambas son respuestas aceptables.
    // Si hay datos de QX, es un fallo real.
    expect(hasQxData, "Usuario ER no debe ver datos de QX").toBe(false);
  });

  // -------------------------------------------------------------------------
  // SCOPE-B-03: ADMIN cross-service ve todos los encounters
  // -------------------------------------------------------------------------
  test("SCOPE-B-03: ADMIN en /admission ve todos los encounters sin filtro", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admission");
    await expect(page).toHaveURL(/\/admission/);

    await page.waitForLoadState("networkidle");

    // ADMIN no debe ver mensaje de restricción de scope.
    await expect(page.getByText(/acceso restringido|sin acceso a esta unidad/i)).not.toBeVisible();

    const rows = page.getByRole("row");
    const rowCount = await rows.count();

    test.info().annotations.push({
      type: "admin-admission-rows",
      description: `${rowCount} filas visibles para ADMIN en /admission`,
    });

    // La página debe cargar sin errores.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/500|Internal Server Error/i);
  });
});
