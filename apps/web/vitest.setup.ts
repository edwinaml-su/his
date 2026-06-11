/**
 * Setup global de Vitest para `@his/web` (entorno jsdom).
 *
 * Neutraliza la navegación real de anclas (`<a href="/ruta">`) en jsdom.
 *
 * Problema que resuelve (flake CI no determinista):
 *   jsdom NO implementa navegación ("Not implemented: navigation"). Cuando un
 *   test hace click en un `<a>` con href no-hash, jsdom programa la navegación
 *   en un `setTimeout` (ver `HTMLHyperlinkElementUtils-impl.js`). Ese timer
 *   puede dispararse MIENTRAS corre un archivo de test posterior y Vitest lo
 *   captura como *unhandled error* → el run completo sale con código 1 aunque
 *   los 302 tests pasen. Es una carrera: local sale 0, CI sale 1 con la misma
 *   base de código.
 *
 * Solución:
 *   Un listener en fase de captura que hace `preventDefault()` sobre clicks en
 *   anclas con href no-hash. Cancelar el default action impide que jsdom
 *   programe el timer de navegación → el error nunca se lanza.
 *
 * Por qué es seguro:
 *   La navegación real (cambio de ruta Next.js) se valida por E2E con Playwright,
 *   NUNCA por estos tests unitarios (ver comentario de thresholds en
 *   vitest.config.ts). Ningún test unitario afirma una navegación de navegador
 *   real; los que prueban routing mockean `next/navigation` (`router.push`).
 */
import { beforeEach } from "vitest";

function cancelAnchorNavigation(event: Event): void {
  const target = event.target as HTMLElement | null;
  const anchor = target?.closest?.("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  // Permite cambios de hash (jsdom SÍ los implementa, p.ej. el skip-link
  // "#main-content" que se prueba en app-shell.test.tsx).
  if (!href || href.startsWith("#")) return;
  event.preventDefault();
}

// Vitest ejecuta este archivo una vez por cada archivo de test, en su propio
// `document` jsdom. Registrar el listener en `beforeEach` garantiza que esté
// activo antes de cualquier click, en cada test.
beforeEach(() => {
  document.addEventListener("click", cancelAnchorNavigation, true);
});
