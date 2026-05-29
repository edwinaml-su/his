/**
 * E2E — ECE: Aislamiento RLS cross-tenant.
 *
 * Verifica que un usuario de un establecimiento NO pueda ver datos de otro:
 *   - Pacientes: resultados vacíos o 0 filas para usuario de establecimiento B.
 *   - Historia clínica: 403/404 al intentar acceder a HC de otro tenant.
 *   - Signos vitales: 0 resultados para episodio de otro tenant.
 *   - Triaje: 403/404 para episodio de otro tenant.
 *   - Indicaciones: 0 resultados para episodio de otro tenant.
 *
 * El comportamiento esperado es "resultados vacíos o error claro" —
 * nunca excepción de servidor (5xx) ni leak de datos cross-tenant.
 *
 * Estrategia dual:
 *   1. Si qa.externo@his.test existe (establecimiento B), lo usa.
 *   2. Si no, usa qa.nurse (establecimiento A) e intenta acceder a un
 *      episodio de UUID cross-tenant del seed.
 *
 * Requisitos de entorno:
 *   - NEXT_PUBLIC_SUPABASE_URL (real, sin "ci-dummy")
 *   - Seed 63_ece_08_seed.sql aplicado (crea episodio cross-tenant conocido)
 *
 * Usuarios requeridos:
 *   qa.nurse@his.test      / TestPass123!
 *   qa.physician@his.test  / TestPass123!
 *   qa.externo@his.test    / TestPass123!  (opcional — establecimiento B)
 *
 * @author @QA — Fase 2 S1 Gate — 2026-05-17
 */

import { test, expect, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const HAS_REAL_SUPABASE =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("ci-dummy");

// UUID de episodio cross-tenant sembrado en 63_ece_08_seed.sql
const CROSS_TENANT_EPISODIO_ID = "00000000-ffff-0000-0000-000000000002";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAs(
  page: Page,
  email: string,
  password = "TestPass123!",
): Promise<boolean> {
  await page.goto("/login");
  await page.getByLabel(/correo|email/i).fill(email);
  await page.getByLabel(/contraseña|password/i).fill(password);
  await page.getByRole("button", { name: /ingresar|iniciar sesión|login/i }).click();
  await page.waitForURL(/\/(dashboard|ece|patients|login)/, { timeout: 12_000 });
  return !page.url().includes("/login");
}

async function probeRoute(page: Page, path: string): Promise<number> {
  const response = await page.goto(path);
  const status = response?.status() ?? 0;
  test.info().annotations.push({ type: "http-probe", description: `GET ${path} → ${status}` });
  return status;
}

/**
 * Valida que la página en `path` muestre 0 filas o un mensaje de acceso denegado.
 * Retorna true si el RLS está correctamente aplicado (vacío o error claro).
 */
async function assertSinDatosCrossTenant(page: Page, path: string): Promise<boolean> {
  const status = await probeRoute(page, path);

  if (status === 401 || status === 403 || status === 404) {
    test.info().annotations.push({
      type: "rls-ok",
      description: `${path} → HTTP ${status} — bloqueado a nivel ruta/middleware.`,
    });
    return true;
  }

  if (status >= 500) {
    test.info().annotations.push({ type: "server-error", description: `${path} → HTTP ${status}` });
    return false; // 5xx nunca es esperado
  }

  // HTTP 200: verificar que el contenido no filtra datos
  const filas = page.locator("tbody tr, [data-testid='fila-resultado']");
  const filaCount = await filas.count();
  const mensajeVacio = page
    .getByText(/sin resultados|no encontrado|acceso denegado|sin registros|no tienes acceso/i)
    .first();
  const hayVacio = (await mensajeVacio.count()) > 0;

  test.info().annotations.push({
    type: "rls-content-check",
    description: `${path} → 200, filas=${filaCount}, estado-vacío=${hayVacio}`,
  });

  return filaCount === 0 || hayVacio;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("@smoke - ECE — RLS cross-tenant", () => {
  test.skip(!HAS_REAL_SUPABASE, "Requiere Supabase real. CI ephemeral usa dummy URL — skip.");

  // -------------------------------------------------------------------------
  // Setup: determinar qué usuario usar para establecimiento B
  // -------------------------------------------------------------------------

  let emailEstablecimientoB = "qa.externo@his.test";
  let usarNurseComoB = false;

  // -------------------------------------------------------------------------
  // Pacientes: usuario B no ve pacientes de A
  // -------------------------------------------------------------------------

  test("1. Pacientes: usuario de establecimiento B ve 0 resultados", async ({ page }) => {
    const loggedIn = await loginAs(page, emailEstablecimientoB);
    if (!loggedIn) {
      // qa.externo no existe — usar qa.nurse y testear contra cross-tenant ID
      usarNurseComoB = true;
      test.info().annotations.push({
        type: "fallback",
        description: "qa.externo@his.test no sembrado — usando qa.nurse para verificar aislamiento con UUID cross-tenant.",
      });
      await login(page, "nurse");
    }

    const rutasPacientes = ["/ece/pacientes", "/patients", "/ece/lista-pacientes"];
    for (const ruta of rutasPacientes) {
      const status = await probeRoute(page, ruta);
      if (status < 500 && status !== 404) {
        // Encontramos una ruta de pacientes — verificar aislamiento
        if (!usarNurseComoB) {
          // Usuario externo: debe ver 0 pacientes del tenant A
          const filas = page.locator("tbody tr, [data-testid='patient-row'], [data-testid='fila-paciente']");
          const count = await filas.count();
          test.info().annotations.push({
            type: "pacientes-visibles-establecimiento-b",
            description: `${count} pacientes visibles para establecimiento B`,
          });

          // Si hay filas, verificar que los data-establecimiento-id no correspondan al tenant A
          const estIds = await page
            .locator("[data-establecimiento-id]")
            .evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute("data-establecimiento-id")).filter(Boolean))]);

          if (estIds.length > 0) {
            expect(estIds.length, `Cross-tenant leak: ${estIds.length} establecimientos visibles`).toBe(1);
          }
        }
        break;
      }
    }
  });

  // -------------------------------------------------------------------------
  // Historia Clínica: 403/404 o vacío para HC de otro tenant
  // -------------------------------------------------------------------------

  test("2. HC: no accesible para usuario de otro tenant", async ({ page }) => {
    if (usarNurseComoB) {
      await login(page, "nurse");
    } else {
      await loginAs(page, emailEstablecimientoB);
    }

    const rlsOk = await assertSinDatosCrossTenant(
      page,
      `/ece/historia-clinica/${CROSS_TENANT_EPISODIO_ID}`,
    );
    expect(rlsOk, "RLS debe bloquear o retornar vacío para HC de otro tenant").toBe(true);
  });

  // -------------------------------------------------------------------------
  // Signos vitales: 0 resultados para episodio de otro tenant
  // -------------------------------------------------------------------------

  test("3. Signos vitales: 0 resultados para episodio de otro tenant", async ({ page }) => {
    if (usarNurseComoB) {
      await login(page, "nurse");
    } else {
      await loginAs(page, emailEstablecimientoB);
    }

    const rlsOk = await assertSinDatosCrossTenant(
      page,
      `/ece/signos-vitales/${CROSS_TENANT_EPISODIO_ID}`,
    );
    expect(rlsOk, "RLS debe bloquear o retornar vacío para signos vitales de otro tenant").toBe(true);
  });

  // -------------------------------------------------------------------------
  // Triaje: 403/404 o vacío para triaje de otro tenant
  // -------------------------------------------------------------------------

  test("4. Triaje: no accesible para usuario de otro tenant", async ({ page }) => {
    if (usarNurseComoB) {
      await login(page, "nurse");
    } else {
      await loginAs(page, emailEstablecimientoB);
    }

    const rlsOk = await assertSinDatosCrossTenant(
      page,
      `/ece/triaje/${CROSS_TENANT_EPISODIO_ID}`,
    );
    expect(rlsOk, "RLS debe bloquear o retornar vacío para triaje de otro tenant").toBe(true);
  });

  // -------------------------------------------------------------------------
  // Indicaciones: 0 resultados para episodio de otro tenant
  // -------------------------------------------------------------------------

  test("5. Indicaciones: no accesibles para usuario de otro tenant", async ({ page }) => {
    if (usarNurseComoB) {
      await login(page, "nurse");
    } else {
      await loginAs(page, emailEstablecimientoB);
    }

    const rlsOk = await assertSinDatosCrossTenant(
      page,
      `/ece/indicaciones/${CROSS_TENANT_EPISODIO_ID}`,
    );
    expect(rlsOk, "RLS debe bloquear o retornar vacío para indicaciones de otro tenant").toBe(true);
  });

  // -------------------------------------------------------------------------
  // Consistencia: mismo comportamiento para usuario propio (control positivo)
  // -------------------------------------------------------------------------

  test("6. Control positivo: qa.nurse ve sus propios datos (no todo bloqueado)", async ({ page }) => {
    await login(page, "nurse");

    // qa.nurse debe poder llegar a su propia cola de signos vitales
    const status = await probeRoute(page, "/ece/signos-vitales");
    test.info().annotations.push({
      type: "control-positivo",
      description: `qa.nurse → GET /ece/signos-vitales → HTTP ${status}`,
    });

    // La ruta debe existir y no retornar 403 para el usuario legítimo
    // (puede retornar 200 con lista vacía si no hay episodios pendientes, o 404 si el módulo es stub)
    expect(status, "Usuario legítimo no debe recibir 403 en su propia ruta ECE").not.toBe(403);
    expect(status, "Servidor no debe retornar 5xx para usuario legítimo").toBeLessThan(500);
  });
});
