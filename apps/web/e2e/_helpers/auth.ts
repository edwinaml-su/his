/**
 * Helpers de autenticación para E2E.
 * En tests E2E reales, debe usar Supabase test users sembrados o un endpoint
 * `/api/test/login` habilitado solo en NODE_ENV=test.
 *
 * Usuarios disponibles (sembrados por packages/database/scripts/seed-test-users.mjs):
 *   qa.admin@his.test      / TestPass123!  → rol ADMIN
 *   qa.triagist@his.test   / TestPass123!  → rol TRIAGIST
 *   qa.physician@his.test  / TestPass123!  → rol PHYSICIAN (MC)
 *   qa.nurse@his.test      / TestPass123!  → rol NURSE (ENF)
 *   qa.director@his.test   / TestPass123!  → rol DIRECTOR (DIR)
 */
import type { Page } from "@playwright/test";

export const TEST_CREDENTIALS = {
  admin:     { email: "qa.admin@his.test",     password: "TestPass123!" },
  triagist:  { email: "qa.triagist@his.test",  password: "TestPass123!" },
  physician: { email: "qa.physician@his.test", password: "TestPass123!" },
  nurse:     { email: "qa.nurse@his.test",     password: "TestPass123!" },
  director:  { email: "qa.director@his.test",  password: "TestPass123!" },
};

// Sin timeout explícito, `waitForURL` usa el default de Playwright (30s) por
// intento. En CI eso es puro tiempo perdido: si el login falla, falla
// determinísticamente (credencial inexistente, backend de auth caído, etc.),
// no por lentitud transitoria. Acotamos a 10s en CI para fallar rápido y
// dejamos el default en local (dev cold-compile puede tardar más).
const LOGIN_REDIRECT_TIMEOUT = process.env.CI ? 10_000 : 30_000;

/**
 * El login (CC-0010) deja en el DOM una copia oculta (`hidden`, id="S:0") de
 * toda la tarjeta — remanente del streaming OOB de Next 16/Turbopack que no
 * se limpia tras el swap. No es un defecto de accesibilidad real (los nodos
 * `hidden` quedan fuera del árbol de accesibilidad, ningún usuario ni lector
 * de pantalla los alcanza), pero SÍ rompe cualquier locator de Playwright que
 * matchee por texto/label/id, porque strict mode cuenta nodos del DOM sin
 * mirar visibilidad. `visible(locator)` filtra al único nodo realmente
 * renderizado. Ver docs/runbooks/e2e-gotrue-auth.md.
 */
function visible(locator: ReturnType<Page["locator"]>) {
  return locator.and(locator.page().locator(":visible"));
}

export async function login(page: Page, who: keyof typeof TEST_CREDENTIALS = "admin") {
  const creds = TEST_CREDENTIALS[who];
  // ?skipIntro=1 salta la animación AxisMed (CC-0010) — la tarjeta de login
  // queda visible de inmediato, sin esperar los ~12.6s de la secuencia.
  await page.goto("/login?skipIntro=1");
  // getByLabel(/contraseña/i) matcheaba también el botón de mostrar/ocultar
  // contraseña (aria-label="Ver/Ocultar contraseña" — correcto en sí mismo,
  // pero contiene la misma palabra). getByRole("textbox", ...) sólo matchea
  // el <input>, nunca un <button>: es la forma robusta de pedir "el campo",
  // no "cualquier cosa que mencione la palabra".
  await visible(page.getByRole("textbox", { name: /correo|email/i })).fill(creds.email);
  await visible(page.getByRole("textbox", { name: /contraseña|password/i })).fill(creds.password);
  // El regex /ingresar|iniciar sesión|login/i también matchea el botón SSO
  // "Iniciar sesión con Microsoft" (contiene "iniciar sesión"). type=submit
  // es el rasgo estable que distingue al botón real del form del botón SSO
  // (type=button) sin importar el copy/idioma.
  await visible(
    page.getByRole("button", { name: /ingresar|iniciar sesión|login/i }).and(page.locator('[type="submit"]')),
  ).click();
  await maybeSelectSede(page);
  try {
    await page.waitForURL(/\/(dashboard|patients|beds|triage|admission)/, {
      timeout: LOGIN_REDIRECT_TIMEOUT,
    });
  } catch (err) {
    // El timeout default de Playwright ("Timeout 10000ms exceeded") no dice
    // NADA sobre la causa. Adjuntamos el estado real de la página para que
    // el fallo sea diagnosticable desde el log de CI sin descargar el trace.
    const currentUrl = page.url();
    const visibleError = await page
      .locator('[role="alert"], .error, [data-testid="login-error"]')
      .first()
      .innerText()
      .catch(() => null);
    throw new Error(
      `login("${who}") no redirigió tras ${LOGIN_REDIRECT_TIMEOUT}ms. ` +
        `URL actual: ${currentUrl}. ` +
        `Mensaje de error visible: ${visibleError ?? "(ninguno)"}. ` +
        `Causa original: ${(err as Error).message}`,
    );
  }
}

/**
 * Paso 2 del login (CC-0010): si el usuario tiene más de una sede activa,
 * aparece un select "Sede" antes de entrar. Si solo tiene una, el login
 * auto-avanza sin mostrar este paso — por eso es tolerante: no falla si
 * el select nunca aparece.
 */
async function maybeSelectSede(page: Page): Promise<void> {
  const sedeSelect = visible(page.locator("#loginSede"));
  try {
    await sedeSelect.waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    return;
  }
  const options = await sedeSelect.locator("option").all();
  if (options.length > 1) {
    const value = await options[1]!.getAttribute("value");
    if (value) await sedeSelect.selectOption(value);
  }
  await visible(page.getByRole("button", { name: /ingresar a la sede|enter site/i })).click();
}
