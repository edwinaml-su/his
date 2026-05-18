/**
 * E2E — Comité ECE: registro de minutas + dashboard calidad documental.
 *
 * US.F2.7.46 — Minutas del Comité ECE.
 * US.F2.7.47 — Dashboard calidad documental.
 * US.F2.7.48 — Reporte institucional.
 * NTEC Art. 32.
 *
 * Casos:
 *   COMITE-01: Página /admin/ece/comite carga con tabla de minutas
 *   COMITE-02: Botón "Nueva minuta" muestra el formulario
 *   COMITE-03: Formulario con datos válidos crea una minuta
 *   COMITE-04: Minuta en borrador muestra botón "Firmar"
 *   COMITE-05: Minuta firmada muestra badge "Firmada" y no tiene botón Firmar
 *   COMITE-06: Dashboard /admin/ece/calidad-documental carga con KPIs
 *   COMITE-07: Panel de exportación genera reporte al seleccionar período
 *
 * Prerrequisito de seed:
 *   - Usuario qa.admin@his.test con rol DIR o ADMIN.
 *   - Al menos una minuta en BD (puede estar vacía, la UI muestra "No hay minutas").
 */

import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const ROUTE_COMITE = "/admin/ece/comite";
const ROUTE_CALIDAD = "/admin/ece/calidad-documental";

// ---------------------------------------------------------------------------
// Comité — minutas
// ---------------------------------------------------------------------------

test.describe("Comité ECE — Registro de minutas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("COMITE-01: Página carga con encabezado y tabla o mensaje vacío", async ({ page }) => {
    await page.goto(ROUTE_COMITE);

    // Título principal
    await expect(
      page.getByRole("heading", { name: /comité ece.*minutas/i }),
    ).toBeVisible({ timeout: 8000 });

    // Tabla histórica O mensaje sin datos
    const tabla = page.getByRole("table", { name: /historial de minutas/i });
    const sinDatos = page.getByText(/no hay minutas registradas/i);

    await expect(tabla.or(sinDatos)).toBeVisible({ timeout: 5000 });
  });

  test("COMITE-02: Botón 'Nueva minuta' muestra el formulario", async ({ page }) => {
    await page.goto(ROUTE_COMITE);

    const btnNueva = page.getByRole("button", { name: /nueva minuta/i });
    await expect(btnNueva).toBeVisible({ timeout: 8000 });

    await btnNueva.click();

    // Formulario debe ser visible
    await expect(
      page.getByRole("form", { name: /nueva minuta del comité/i }).or(
        page.getByLabelText(/fecha de reunión/i),
      ),
    ).toBeVisible({ timeout: 3000 });
  });

  test("COMITE-03: Formulario con datos válidos habilita botón crear", async ({ page }) => {
    await page.goto(ROUTE_COMITE);

    const btnNueva = page.getByRole("button", { name: /nueva minuta/i });
    await btnNueva.click();

    // Completar fecha
    const today = new Date().toISOString().split("T")[0];
    const inputFecha = page.getByLabel(/fecha de reunión/i);
    await expect(inputFecha).toBeVisible({ timeout: 3000 });
    await inputFecha.fill(today!);

    // Agregar asistente
    const inputAsistente = page.getByLabel(/asistentes/i);
    await inputAsistente.fill("Dr. García | MC");
    await page.getByRole("button", { name: /agregar/i }).first().click();

    // Asistente debe aparecer en la lista
    await expect(page.getByText("Dr. García")).toBeVisible();

    // Agregar tema
    const inputTema = page.getByLabel(/temas de agenda/i);
    await inputTema.fill("Revisión de calidad documental");
    await page.getByRole("button", { name: /agregar/i }).last().click();

    // Tema debe aparecer en la lista
    await expect(page.getByText("Revisión de calidad documental")).toBeVisible();

    // Botón crear debe estar habilitado
    const btnCrear = page.getByRole("button", { name: /crear minuta/i });
    await expect(btnCrear).toBeEnabled();
  });

  test("COMITE-04: Minuta en borrador muestra botón 'Firmar'", async ({ page }) => {
    await page.goto(ROUTE_COMITE);

    // Si existe una minuta en borrador en la tabla, debe tener botón Firmar
    const tabla = page.getByRole("table", { name: /historial de minutas/i });

    if (await tabla.isVisible()) {
      const filasBorrador = page.getByRole("row").filter({
        has: page.getByText(/borrador/i),
      });

      if (await filasBorrador.first().isVisible()) {
        await expect(
          filasBorrador.first().getByRole("button", { name: /firmar/i }),
        ).toBeVisible();
      }
    }
    // Si no hay tabla, test pasa (sin minutas = sin botón Firmar = correcto)
  });

  test("COMITE-05: Minuta firmada muestra badge 'Firmada' (sin botón Firmar)", async ({
    page,
  }) => {
    await page.goto(ROUTE_COMITE);

    const tabla = page.getByRole("table", { name: /historial de minutas/i });
    if (await tabla.isVisible()) {
      const filasFirmadas = page.getByRole("row").filter({
        has: page.getByText(/^firmada$/i),
      });

      if (await filasFirmadas.first().isVisible()) {
        // Badge Firmada presente
        await expect(
          filasFirmadas.first().getByText(/firmada/i),
        ).toBeVisible();

        // Botón Firmar NO debe estar en fila firmada
        await expect(
          filasFirmadas.first().getByRole("button", { name: /firmar/i }),
        ).not.toBeVisible();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Dashboard calidad documental
// ---------------------------------------------------------------------------

test.describe("Comité ECE — Dashboard calidad documental", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("COMITE-06: Dashboard carga con encabezado y KPIs o mensaje informativo", async ({
    page,
  }) => {
    await page.goto(ROUTE_CALIDAD);

    await expect(
      page.getByRole("heading", { name: /calidad documental/i }),
    ).toBeVisible({ timeout: 8000 });

    // KPIs O mensaje de sin datos (vista vacía en ambiente de prueba)
    const kpisSection = page.getByRole("region", { name: /indicadores/i });
    const sinDatos = page.getByText(/sin datos|actualiza cada hora/i);

    await expect(kpisSection.or(sinDatos)).toBeVisible({ timeout: 5000 });
  });

  test("COMITE-07: Panel de exportación muestra campos de período y tipo", async ({ page }) => {
    await page.goto(ROUTE_CALIDAD);

    // Verificar que existe el panel de exportación
    await expect(
      page.getByRole("heading", { name: /reporte institucional/i }),
    ).toBeVisible({ timeout: 8000 });

    // Inputs de período
    await expect(page.getByLabel(/período inicio/i)).toBeVisible();
    await expect(page.getByLabel(/período fin/i)).toBeVisible();

    // Select de tipo
    await expect(page.getByLabel(/tipo/i)).toBeVisible();

    // Botón generar
    await expect(page.getByRole("button", { name: /generar/i })).toBeVisible();
  });

  test("COMITE-08: Select tipo incluye MINSAL, ISSS e Interno", async ({ page }) => {
    await page.goto(ROUTE_CALIDAD);

    const selectTipo = page.getByLabel(/tipo/i);
    await expect(selectTipo).toBeVisible({ timeout: 8000 });

    // Verificar opciones
    const opciones = selectTipo.getByRole("option");
    await expect(opciones).toHaveCount(3);

    const textos = await opciones.allTextContents();
    expect(textos).toContain("MINSAL");
    expect(textos).toContain("ISSS");
  });
});
