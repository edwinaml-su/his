/**
 * Sonda de rutas compartida para specs E2E que navegan a páginas potencialmente
 * no desplegadas (features en construcción, módulos ECE en stub).
 *
 * Unifica dos variantes homónimas de `probeRoute` que convivían duplicadas en
 * 10 specs con semántica opuesta (ver docs/qa/e2e-auditoria-rutas-2026-08-26.md,
 * sección "Hallazgo transversal"):
 *   - Variante A (`status < 500` → true): un 404 pasaba la sonda y el test
 *     seguía navegando contra una página de error → fallos fantasma aguas
 *     abajo, sin pista de la causa real.
 *   - Variante B (`if (status === 404) return`): el test se auto-skipeaba en
 *     silencio y reportaba verde → cobertura que figuraba como existente y no
 *     existía.
 *
 * Este helper falla el test explícitamente ante 404 o 5xx en vez de tolerarlos
 * en silencio. Si un spec migrado empieza a fallar tras este cambio, es señal
 * real de una ruta rota — no un defecto de la sonda. Las rutas del "Bloque B"
 * de la auditoría sin candidato de fix (decisión de producto pendiente en
 * backlog @PO) van a fallar así a propósito.
 */
import { test, expect, type Page } from "@playwright/test";

/**
 * Navega a `path` y devuelve el status HTTP de la respuesta.
 *
 * Falla el test (vía `expect`) si la ruta responde 404 (no implementada) o
 * 5xx (error de servidor) — nunca "pasa" silenciosamente. Statuses 401/403
 * (bloqueo de auth/RBAC esperado por diseño) sí se retornan para que el
 * llamador los interprete.
 */
export async function probeRoute(page: Page, path: string): Promise<number> {
  const response = await page.goto(path);
  const status = response?.status() ?? 0;
  test.info().annotations.push({ type: "route-probe", description: `GET ${path} → ${status}` });
  expect(
    status,
    `Ruta inexistente: ${path} — ver docs/qa/e2e-auditoria-rutas-2026-08-26.md`,
  ).not.toBe(404);
  expect(status, `Error de servidor en ${path}: HTTP ${status}`).toBeLessThan(500);
  return status;
}
