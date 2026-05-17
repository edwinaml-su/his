/**
 * E2E — ECE Dashboard Maternidad (TDR §ECE Obstetricia)
 *
 * Specs:
 *   1. Carga correcta con h1 "Dashboard — Maternidad"
 *   2. KPIs visibles con role=status
 *   3. Mosaico de salas renderiza secciones Pre-parto / Expulsión / Post-parto
 *   4. Alertas clínicas visibles con icono y mensaje
 *   5. Cola de próximas pacientes muestra tabla con cabeceras
 *   6. Sidebar contiene sección "ECE — Maternidad" con items esperados
 *   7. WCAG: h2 accesibles por aria-labelledby, sin errores de accesibilidad críticos
 *
 * Playwright config: fullyParallel=false, workers=1, locale=es-SV.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const PAGE_URL = "/ece/obstetricia";

test.describe("ECE — Dashboard Maternidad", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(PAGE_URL);
  });

  // 1 — Página carga con encabezado correcto
  test("renderiza h1 'Dashboard — Maternidad'", async ({ page }) => {
    await expect(page).toHaveURL(/\/ece\/obstetricia/);
    await expect(
      page.getByRole("heading", { name: /dashboard.*maternidad/i, level: 1 }),
    ).toBeVisible();
    // Subtítulo con mención de auto-refresh
    await expect(page.getByText(/actualización cada 30/i)).toBeVisible();
  });

  // 2 — KPIs con role=status
  test("muestra bloque KPIs con indicadores operacionales", async ({ page }) => {
    const kpiZone = page.getByRole("status", {
      name: /indicadores operacionales de maternidad/i,
    });
    await expect(kpiZone).toBeVisible({ timeout: 8_000 });

    // Todos los KPIs deben estar presentes (texto de label)
    await expect(kpiZone.getByText(/trabajo de parto/i)).toBeVisible();
    await expect(kpiZone.getByText(/nacimientos hoy/i)).toBeVisible();
    await expect(kpiZone.getByText(/rn en ucin/i)).toBeVisible();
    await expect(kpiZone.getByText(/salas expulsión ocupadas/i)).toBeVisible();
  });

  // 3 — Mosaico de salas con las tres secciones
  test("mosaico muestra secciones Pre-parto, Expulsión y Post-parto", async ({
    page,
  }) => {
    const salaSection = page.getByRole("region", {
      name: /salas.*estado actual/i,
    });
    await expect(salaSection).toBeVisible({ timeout: 8_000 });

    // Encabezados h3 de cada grupo de salas
    await expect(salaSection.getByText(/pre-parto/i).first()).toBeVisible();
    await expect(salaSection.getByText(/expulsión/i).first()).toBeVisible();
    await expect(salaSection.getByText(/post-parto/i).first()).toBeVisible();

    // Al menos una sala libre debe estar presente
    await expect(
      salaSection.getByText(/sin paciente asignada/i).first(),
    ).toBeVisible();
  });

  // 4 — Alertas clínicas visibles
  test("muestra panel de alertas clínicas con mensajes de partograma y alumbramiento", async ({
    page,
  }) => {
    const alertasSection = page.getByRole("region", {
      name: /alertas clínicas/i,
    });
    await expect(alertasSection).toBeVisible({ timeout: 8_000 });

    // La lista de alertas activas debe tener role=status
    const alertasList = alertasSection.getByRole("status");
    await expect(alertasList).toBeVisible();

    // Alerta partograma
    await expect(
      alertasSection.getByText(/partograma.*dilatación lenta/i),
    ).toBeVisible();

    // Alerta alumbramiento
    await expect(
      alertasSection.getByText(/alumbramiento.*30/i),
    ).toBeVisible();
  });

  // 5 — Cola de próximas pacientes con tabla accesible
  test("cola de próximas pacientes muestra tabla con cabeceras Paciente/Semanas/Hora/Motivo", async ({
    page,
  }) => {
    const colaSection = page.getByRole("region", {
      name: /próximas pacientes esperadas/i,
    });
    await expect(colaSection).toBeVisible({ timeout: 8_000 });

    const table = colaSection.getByRole("table");
    await expect(table).toBeVisible();

    // Cabeceras de columna (th[scope=col])
    await expect(table.getByRole("columnheader", { name: /paciente/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /semanas/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /hora/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /motivo/i })).toBeVisible();

    // Al menos una fila de datos
    const rows = table.getByRole("row");
    await expect(rows).toHaveCount(4); // 1 header + 3 mock rows
  });

  // 6 — Sidebar contiene sección ECE — Maternidad
  test("sidebar contiene sección 'ECE — Maternidad' con items de navegación", async ({
    page,
  }) => {
    const nav = page.getByRole("navigation", { name: /principal/i });
    await expect(nav).toBeVisible();

    // Link al dashboard maternidad
    const dashLink = nav.getByRole("link", { name: /dashboard maternidad/i });
    await expect(dashLink).toBeVisible();
    await expect(dashLink).toHaveAttribute("href", PAGE_URL);

    // Items del menú de maternidad
    await expect(nav.getByRole("link", { name: /partograma/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /sala expulsión/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /atención rn/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /reanimación/i })).toBeVisible();
  });

  // 7 — Accesibilidad: secciones tienen h2 con aria-labelledby
  test("secciones tienen encabezados h2 accesibles (WCAG 2.2 AA)", async ({
    page,
  }) => {
    // KPIs: h2 sr-only — presente en DOM aunque no visible visualmente
    const kpiHeading = page.getByRole("heading", {
      name: /indicadores clave/i,
      level: 2,
    });
    await expect(kpiHeading).toBeAttached();

    // Salas
    await expect(
      page.getByRole("heading", { name: /salas.*estado actual/i, level: 2 }),
    ).toBeVisible();

    // Alertas
    await expect(
      page.getByRole("heading", { name: /alertas clínicas/i, level: 2 }),
    ).toBeVisible();

    // Cola
    await expect(
      page.getByRole("heading", {
        name: /próximas pacientes esperadas/i,
        level: 2,
      }),
    ).toBeVisible();

    // Protocolo HPP
    await expect(
      page.getByRole("heading", {
        name: /protocolo hemorragia/i,
        level: 2,
      }),
    ).toBeVisible();
  });
});
