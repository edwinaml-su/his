/**
 * Helpers de UI compartidos para E2E (selects, etc.).
 */
import type { Locator } from "@playwright/test";

/**
 * `Locator.selectOption({ label })` de Playwright solo acepta un `string` —
 * pasarle un `RegExp` no lanza en tiempo de compilación laxo (los specs E2E
 * no corren por `npm run typecheck`, ver CLAUDE.md), pero en runtime
 * Playwright serializa el objeto y NUNCA matchea ninguna `<option>` real.
 * Varios specs `ece-flujo-*-completo` tenían este bug (`selectOption({
 * label: /regex/i })`) — este helper busca la `<option>` cuyo texto visible
 * matchea el regex y selecciona por su `value` real.
 *
 * Devuelve `true` si encontró y seleccionó una opción, `false` si ninguna
 * matcheó — el caller decide si eso amerita warning o continuar por otra vía
 * (mismo patrón defensivo que ya usaban estos specs).
 */
export async function selectOptionMatching(select: Locator, pattern: RegExp): Promise<boolean> {
  const options = await select.locator("option").all();
  for (const option of options) {
    const text = (await option.textContent()) ?? "";
    if (pattern.test(text)) {
      const value = await option.getAttribute("value");
      await select.selectOption(value ?? text.trim());
      return true;
    }
  }
  return false;
}
