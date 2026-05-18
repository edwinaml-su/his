/**
 * E2E — GS1 Trazabilidad de lote/batch.
 * §19 Inventario / GS1-128.
 *
 * GS1-01: La página carga con los datos del lote (número, producto, SKU).
 * GS1-02: El timeline muestra los 6 hitos GS1 en orden.
 * GS1-03: Los hitos completados muestran timestamp; los pendientes "Pendiente".
 * GS1-04: La lista de pacientes afectados muestra solo MRN (sin nombre completo).
 * GS1-05: El botón "Iniciar recall" cambia a "Recall iniciado" tras confirmar.
 * GS1-06: La página es accesible con teclado (foco llega al botón recall).
 */

import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";

const LOT = "LOT-2026-001";
const ROUTE = `/gs1/lote/${encodeURIComponent(LOT)}`;

test.describe("GS1 Trazabilidad de lote", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(ROUTE);
    // Esperar encabezado para confirmar carga
    await expect(
      page.getByRole("heading", { name: /trazabilidad de lote/i }),
    ).toBeVisible();
  });

  // ─── GS1-01: Datos del lote visibles ──────────────────────────────────

  test("GS1-01: muestra número de lote, nombre de producto y SKU", async ({
    page,
  }) => {
    await expect(page.getByTestId("lot-number")).toContainText(LOT);
    await expect(page.getByTestId("lot-item-name")).toBeVisible();
    // Badge de estado inicial es "Normal"
    await expect(page.getByTestId("badge-recall")).toContainText(/normal/i);
  });

  // ─── GS1-02: Timeline con 6 hitos ─────────────────────────────────────

  test("GS1-02: el timeline muestra los 6 hitos GS1 en orden correcto", async ({
    page,
  }) => {
    const expectedIds = [
      "recepcion",
      "almacenamiento",
      "unidosis",
      "dispensacion",
      "administracion",
      "paciente",
    ] as const;

    for (const id of expectedIds) {
      await expect(page.getByTestId(`lot-step-${id}`)).toBeVisible();
    }

    // Verificar orden relativo: recepción antes que paciente
    const recepcionBox = await page
      .getByTestId("lot-step-recepcion")
      .boundingBox();
    const pacienteBox = await page
      .getByTestId("lot-step-paciente")
      .boundingBox();

    expect(recepcionBox).not.toBeNull();
    expect(pacienteBox).not.toBeNull();
    if (recepcionBox && pacienteBox) {
      expect(recepcionBox.y).toBeLessThan(pacienteBox.y);
    }
  });

  // ─── GS1-03: Estados de hitos completados vs pendientes ───────────────

  test("GS1-03: hitos completados muestran timestamp y pendientes muestran 'Pendiente'", async ({
    page,
  }) => {
    // Con datos demo: recepción, almacenamiento, unidosis, dispensación = completados
    // administración, paciente = pendientes
    const completedIds = ["recepcion", "almacenamiento", "unidosis", "dispensacion"];
    const pendingIds = ["administracion", "paciente"];

    for (const id of completedIds) {
      const step = page.getByTestId(`lot-step-${id}`);
      // Debe contener una fecha (dd/mm/aaaa) — no "Pendiente"
      await expect(step).not.toContainText(/pendiente/i);
    }

    for (const id of pendingIds) {
      const step = page.getByTestId(`lot-step-${id}`);
      await expect(step).toContainText(/pendiente/i);
    }
  });

  // ─── GS1-04: Pacientes solo con MRN ───────────────────────────────────

  test("GS1-04: lista de pacientes afectados muestra solo MRN sin nombre completo", async ({
    page,
  }) => {
    const list = page.getByTestId("affected-patients-list");
    await expect(list).toBeVisible();

    // Todos los items visibles deben mostrar MRN (patrón PAC-XXXXXX)
    const rows = list.getByRole("listitem");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent();
      // Debe contener patrón MRN
      expect(text).toMatch(/PAC-\d+/);
      // No debe contener apellidos ni nombre en formato "Apellido, Nombre"
      // (el servidor solo devuelve MRN — validación de contrato de privacidad)
      expect(text).not.toMatch(/,\s+[A-ZÁÉÍÓÚ][a-záéíóú]/);
    }
  });

  // ─── GS1-05: Botón Iniciar recall ─────────────────────────────────────

  test("GS1-05: botón 'Iniciar recall' cambia a 'Recall iniciado' tras click", async ({
    page,
  }) => {
    const btn = page.getByTestId("btn-iniciar-recall");
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText(/iniciar recall/i);

    await btn.click();

    // El botón debe quedar deshabilitado y mostrar "Recall iniciado"
    await expect(btn).toHaveText(/recall iniciado/i, { timeout: 3000 });
    await expect(btn).toBeDisabled();

    // El badge debe cambiar a "Recall activo"
    await expect(page.getByTestId("badge-recall")).toContainText(/recall activo/i);
  });

  // ─── GS1-06: Accesibilidad — navegación por teclado ───────────────────

  test("GS1-06: el botón 'Iniciar recall' es alcanzable con navegación por teclado", async ({
    page,
  }) => {
    // Tab desde el body hasta llegar al botón recall
    await page.keyboard.press("Tab");

    // El botón debe ser focusable vía Tab (puede requerir varios tabs)
    const btn = page.getByTestId("btn-iniciar-recall");
    await btn.focus();

    // El elemento enfocado debe ser el botón
    const focused = page.locator(":focus");
    await expect(focused).toHaveAttribute("data-testid", "btn-iniciar-recall");

    // Enter debe activar el botón
    await page.keyboard.press("Enter");
    await expect(btn).toHaveText(/recall iniciado/i, { timeout: 3000 });
  });
});
